import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createSyncEngine, type BroadcastPort, type SyncEvent } from './engine';

type Payload = Record<string, number>;

/** In-memory Storage so tests are independent of jsdom's localStorage lifecycle. */
function makeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
  } as Storage;
}

/** Controllable clock so debounce and backoff are deterministic. */
function makeClock() {
  let nextId = 1;
  const timers = new Map<number, { fn: () => void; at: number }>();
  let current = 0;

  return {
    setTimeoutFn: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { fn, at: current + ms });
      return id;
    },
    clearTimeoutFn: (id: number) => void timers.delete(id),
    async advance(ms: number) {
      current += ms;
      const due = [...timers.entries()]
        .filter(([, t]) => t.at <= current)
        .sort((a, b) => a[1].at - b[1].at);
      for (const [id, timer] of due) {
        timers.delete(id);
        timer.fn();
        // Drain whatever the callback started. A real macrotask is used rather than a
        // fixed number of `Promise.resolve()` ticks because `fetch` → `response.json()`
        // takes an engine-dependent number of them. Only the engine's timers are faked,
        // so the global setTimeout is still real.
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    },
    pending: () => timers.size,
  };
}

function ok(version: number) {
  return new Response(JSON.stringify({ version }), { status: 200 });
}

type Harness = ReturnType<typeof makeHarness>;

function makeHarness(
  overrides: Partial<Parameters<typeof createSyncEngine<Payload>>[0]> = {},
  fetchImpl?: ReturnType<typeof vi.fn>,
) {
  const clock = makeClock();
  const storage = makeStorage();
  const applied: Array<{ key: string; data: Payload }> = [];
  const events: SyncEvent<Payload>[] = [];
  const fetchFn = fetchImpl ?? vi.fn(async () => ok(1));

  const engine = createSyncEngine<Payload>({
    name: 'test',
    recordUrl: (key) => `/api/test/${key}`,
    storage,
    fetch: fetchFn as unknown as typeof fetch,
    onApply: (key, data) => void applied.push({ key, data }),
    setTimeoutFn: clock.setTimeoutFn,
    clearTimeoutFn: clock.clearTimeoutFn,
    broadcast: null,
    ...overrides,
  });

  engine.subscribe((event) => events.push(event));
  return { engine, clock, storage, applied, events, fetchFn };
}

let h: Harness;

beforeEach(() => {
  h = makeHarness();
});

describe('queueing and debounce', () => {
  it('does not push until the debounce elapses', async () => {
    h.engine.setSignedIn(true);
    h.engine.queue('SOR', { '059': 1 });

    expect(h.fetchFn).not.toHaveBeenCalled();
    await h.clock.advance(1000);
    expect(h.fetchFn).toHaveBeenCalledTimes(1);
  });

  it('coalesces rapid writes into one request with the latest value', async () => {
    h.engine.setSignedIn(true);
    h.engine.queue('SOR', { '059': 1 });
    await h.clock.advance(200);
    h.engine.queue('SOR', { '059': 2 });
    await h.clock.advance(200);
    h.engine.queue('SOR', { '059': 3 });
    await h.clock.advance(1000);

    expect(h.fetchFn).toHaveBeenCalledTimes(1);
    const body = JSON.parse(h.fetchFn.mock.calls[0]![1].body);
    expect(body.data).toEqual({ '059': 3 });
  });

  it('keeps separate keys independent', async () => {
    h.engine.setSignedIn(true);
    h.engine.queue('SOR', { '059': 1 });
    h.engine.queue('LOF', { '142': 1 });
    await h.clock.advance(1000);

    expect(h.fetchFn).toHaveBeenCalledTimes(2);
    expect(h.fetchFn.mock.calls.map((c) => c[0]).sort()).toEqual([
      '/api/test/LOF',
      '/api/test/SOR',
    ]);
  });

  it('persists queued writes so a reload cannot lose them', () => {
    h.engine.queue('SOR', { '059': 4 });
    expect(h.engine.getState().pending.SOR).toEqual({ '059': 4 });
    expect(h.engine.hasPending()).toBe(true);
  });

  it('queues while signed out and flushes on sign-in', async () => {
    h.engine.queue('SOR', { '059': 1 });
    await h.clock.advance(5000);
    expect(h.fetchFn).not.toHaveBeenCalled();

    h.engine.setSignedIn(true);
    await Promise.resolve();
    await Promise.resolve();

    expect(h.fetchFn).toHaveBeenCalledTimes(1);
  });
});

describe('versioning', () => {
  it('sends the known version as if-match and records the new one', async () => {
    h.engine.setSignedIn(true);
    h.engine.queue('SOR', { '059': 1 });
    await h.clock.advance(1000);

    expect(h.fetchFn.mock.calls[0]![1].headers['if-match']).toBe('0');
    expect(h.engine.getState().versions.SOR).toBe(1);
    expect(h.engine.hasPending()).toBe(false);

    h.fetchFn.mockResolvedValueOnce(ok(2));
    h.engine.queue('SOR', { '059': 2 });
    await h.clock.advance(1000);
    expect(h.fetchFn.mock.calls[1]![1].headers['if-match']).toBe('1');
  });
});

describe('conflicts', () => {
  it('adopts the server copy on 409 instead of clobbering another device', async () => {
    const fetchFn = vi.fn(
      async () =>
        new Response(JSON.stringify({ current: { data: { '059': 9 }, version: 7 } }), {
          status: 409,
        }),
    );
    const local = makeHarness({}, fetchFn);

    local.engine.setSignedIn(true);
    local.engine.queue('SOR', { '059': 1 });
    await local.clock.advance(1000);

    expect(local.applied).toEqual([{ key: 'SOR', data: { '059': 9 } }]);
    expect(local.engine.getState().versions.SOR).toBe(7);
    // Our losing write is dropped, not retried into a loop.
    expect(local.engine.hasPending()).toBe(false);
    expect(local.engine.getStatus()).toBe('idle');
  });
});

describe('merging with another device', () => {
  /** Three-way, per key: the server's value plus whatever this device changed. */
  const merge = (local: Payload, remote: Payload, base: Payload | undefined): Payload => {
    const out: Payload = { ...remote };
    for (const key of new Set([...Object.keys(local), ...Object.keys(base ?? {})])) {
      const delta = (local[key] ?? 0) - (base?.[key] ?? 0);
      out[key] = Math.max(0, (remote[key] ?? 0) + delta);
    }
    return out;
  };

  it('on 409, keeps both changes and pushes the merge at the server version', async () => {
    const fetchFn = vi
      .fn()
      // Agreed base: 059 x2.
      .mockResolvedValueOnce(ok(1))
      // Meanwhile another device made it 059 x2, 324 x1 (version 2).
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ current: { data: { '059': 2, '324': 1 }, version: 2 } }), {
          status: 409,
        }),
      )
      .mockResolvedValueOnce(ok(3));
    const local = makeHarness({ merge }, fetchFn);
    local.engine.setSignedIn(true);

    local.engine.queue('SOR', { '059': 2 });
    await local.clock.advance(1000);
    // This device adds a third 059, unaware of the other device's 324.
    local.engine.queue('SOR', { '059': 3 });
    await local.clock.advance(1000);
    await new Promise((resolve) => setTimeout(resolve, 0));

    const lastBody = JSON.parse(fetchFn.mock.calls.at(-1)![1].body as string) as { data: Payload };
    expect(lastBody.data).toEqual({ '059': 3, '324': 1 });
    expect(fetchFn.mock.calls.at(-1)![1].headers['if-match']).toBe('2');
    expect(local.applied.at(-1)).toEqual({ key: 'SOR', data: { '059': 3, '324': 1 } });
    expect(local.engine.hasPending()).toBe(false);
  });

  it('applies a newer pulled copy directly when nothing is pending, and ignores stale ones', async () => {
    const local = makeHarness({ merge });
    await local.engine.receive('SOR', { '059': 4 }, 5);
    expect(local.applied).toEqual([{ key: 'SOR', data: { '059': 4 } }]);
    expect(local.engine.getState().versions.SOR).toBe(5);

    await local.engine.receive('SOR', { '059': 1 }, 5);
    expect(local.applied).toHaveLength(1);
  });

  it('records no version for a pulled copy it could not store, so a later write merges', async () => {
    // The incident: a device "received" SOR without storing it, so it claimed the server's
    // version while holding no SOR cards. Its next tap replaced the server's SOR with one
    // card, then none, and every other device pulled the empty set.
    const server: Payload = { '093': 1, '094F': 1 };
    let applyFails = true;
    const applied: Payload[] = [];
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ current: { data: server, version: 1 } }), { status: 409 }),
      )
      .mockResolvedValueOnce(ok(2));
    const local = makeHarness(
      {
        merge,
        onApply: (_key, data) => {
          if (applyFails) throw new Error('catalog not loaded');
          applied.push(data);
        },
      },
      fetchFn,
    );

    await expect(local.engine.receive('SOR', server, 1)).rejects.toThrow();
    expect(local.engine.getState().versions.SOR).toBeUndefined();

    // A tap in the (wrongly) empty binder, once the device can store SOR again.
    applyFails = false;
    local.engine.setSignedIn(true);
    local.engine.queue('SOR', { '236': 1 });
    await local.clock.advance(1000);
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Pushed at version 0, refused, merged: the server's cards survive alongside the tap.
    expect(fetchFn.mock.calls[0]![1].headers['if-match']).toBe('0');
    const lastBody = JSON.parse(fetchFn.mock.calls.at(-1)![1].body as string) as { data: Payload };
    expect(lastBody.data).toEqual({ '093': 1, '094F': 1, '236': 1 });
    expect(applied.at(-1)).toEqual({ '093': 1, '094F': 1, '236': 1 });
  });

  it('keeps a write queued while a pulled copy was being stored', async () => {
    let queueDuringApply: (() => void) | undefined;
    const local = makeHarness({
      merge,
      onApply: () => {
        queueDuringApply?.();
        queueDuringApply = undefined;
      },
    });
    queueDuringApply = () => local.engine.queue('SOR', { '059': 4, '080': 1 });

    await local.engine.receive('SOR', { '059': 4 }, 3);
    expect(local.engine.getState().versions.SOR).toBe(3);
    expect(local.engine.getState().pending.SOR).toEqual({ '059': 4, '080': 1 });
  });

  it('merges a pulled copy into a pending write instead of dropping it', async () => {
    const local = makeHarness({ merge });
    await local.engine.receive('SOR', { '059': 2 }, 1);
    local.engine.queue('SOR', { '059': 2, '080': 1 });

    await local.engine.receive('SOR', { '059': 1 }, 2);
    expect(local.engine.getState().pending.SOR).toEqual({ '059': 1, '080': 1 });
    expect(local.engine.getState().versions.SOR).toBe(2);
  });
});

describe('failures', () => {
  it('retries with backoff and only reports after three consecutive failures', async () => {
    const fetchFn = vi.fn(async () => new Response('boom', { status: 500 }));
    const local = makeHarness({}, fetchFn);

    local.engine.setSignedIn(true);
    local.engine.queue('SOR', { '059': 1 });

    await local.clock.advance(1000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(local.engine.getStatus()).toBe('error');
    expect(local.events.filter((e) => e.type === 'error')).toHaveLength(0);

    await local.clock.advance(1000);
    expect(fetchFn).toHaveBeenCalledTimes(2);
    await local.clock.advance(2000);
    expect(fetchFn).toHaveBeenCalledTimes(3);

    const errors = local.events.filter((e) => e.type === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatchObject({ key: 'SOR', consecutive: 3 });
  });

  it('keeps the write pending across failures', async () => {
    const fetchFn = vi.fn(async () => new Response('boom', { status: 500 }));
    const local = makeHarness({}, fetchFn);

    local.engine.setSignedIn(true);
    local.engine.queue('SOR', { '059': 1 });
    await local.clock.advance(1000);

    expect(local.engine.hasPending()).toBe(true);
    expect(local.engine.getState().pending.SOR).toEqual({ '059': 1 });
  });

  it('signs out on 401 and stops trying', async () => {
    const fetchFn = vi.fn(async () => new Response('nope', { status: 401 }));
    const local = makeHarness({}, fetchFn);

    local.engine.setSignedIn(true);
    local.engine.queue('SOR', { '059': 1 });
    await local.clock.advance(1000);

    expect(local.events.some((e) => e.type === 'signout')).toBe(true);
    expect(local.engine.getStatus()).toBe('off');

    await local.clock.advance(60000);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('reports offline rather than error when the network is down', async () => {
    const fetchFn = vi.fn(async () => ok(1));
    const local = makeHarness({ isOnline: () => false }, fetchFn);

    local.engine.setSignedIn(true);
    local.engine.queue('SOR', { '059': 1 });
    await local.clock.advance(1000);

    // The legacy engine declared an 'offline' status and then never used it.
    expect(local.engine.getStatus()).toBe('offline');
    expect(fetchFn).not.toHaveBeenCalled();
    expect(local.engine.hasPending()).toBe(true);
  });
});

describe('cross-tab broadcast', () => {
  it('applies a value another tab pushed, without echoing it back', async () => {
    let handler: ((p: { key: string; data: Payload; version: number }) => void) | undefined;
    const port: BroadcastPort<Payload> = {
      postMessage: vi.fn(),
      onMessage: (fn) => {
        handler = fn;
        return () => {};
      },
    };
    const local = makeHarness({ broadcast: port });

    local.engine.queue('SOR', { '059': 1 });
    handler?.({ key: 'SOR', data: { '059': 5 }, version: 3 });
    // Stored first, then its version recorded.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(local.applied).toEqual([{ key: 'SOR', data: { '059': 5 } }]);
    expect(local.engine.getState().versions.SOR).toBe(3);
    expect(local.engine.hasPending()).toBe(false);
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it('broadcasts its own successful pushes', async () => {
    const port: BroadcastPort<Payload> = { postMessage: vi.fn(), onMessage: () => () => {} };
    const local = makeHarness({ broadcast: port });

    local.engine.setSignedIn(true);
    local.engine.queue('SOR', { '059': 1 });
    await local.clock.advance(1000);

    expect(port.postMessage).toHaveBeenCalledWith({
      key: 'SOR',
      data: { '059': 1 },
      version: 1,
    });
  });
});

describe('lifecycle', () => {
  it('reports status transitions', async () => {
    h.engine.setSignedIn(true);
    h.engine.queue('SOR', { '059': 1 });
    await h.clock.advance(1000);

    const statuses = h.events.filter((e) => e.type === 'status').map((e) => e.status);
    expect(statuses).toEqual(['idle', 'pushing', 'idle']);
  });

  it('goes to off and cancels nothing on sign-out', () => {
    h.engine.setSignedIn(true);
    h.engine.setSignedIn(false);
    expect(h.engine.getStatus()).toBe('off');
  });

  it('cancels outstanding timers on dispose', async () => {
    h.engine.setSignedIn(true);
    h.engine.queue('SOR', { '059': 1 });
    expect(h.clock.pending()).toBeGreaterThan(0);

    h.engine.dispose();
    expect(h.clock.pending()).toBe(0);
  });

  it('survives unreadable persisted state', () => {
    h.storage.setItem('sync:test', 'not json');
    expect(h.engine.getState()).toEqual({ versions: {}, pending: {}, base: {}, lastPulledAt: 0 });
  });
});
