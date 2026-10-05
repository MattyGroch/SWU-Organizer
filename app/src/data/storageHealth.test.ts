import { afterEach, describe, expect, it, vi } from 'vitest';

import { SwuDatabase } from './db';
import { createHealthStore, startInstanceWatch, watchStorage } from './storageHealth';

afterEach(() => {
  vi.useRealTimers();
});

describe('createHealthStore', () => {
  it('reports a stall once a request has been pending STALL_MS, and clears when it settles', async () => {
    vi.useFakeTimers();
    const store = createHealthStore({ stallMs: 4000 });
    const changes = vi.fn();
    store.subscribe(changes);

    let settle!: () => void;
    void store.track(new Promise<void>((resolve) => (settle = resolve)));
    await vi.advanceTimersByTimeAsync(3000);
    expect(store.get().stalled).toBe(false);
    await vi.advanceTimersByTimeAsync(1500);
    expect(store.get().stalled).toBe(true);

    settle();
    await vi.advanceTimersByTimeAsync(0);
    expect(store.get().stalled).toBe(false);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('does not count a request that failed as stuck', async () => {
    vi.useFakeTimers();
    const store = createHealthStore({ stallMs: 4000 });
    await expect(store.track(Promise.reject(new Error('nope')))).rejects.toThrow('nope');
    await vi.advanceTimersByTimeAsync(5000);
    expect(store.get().stalled).toBe(false);
  });
});

describe('watchStorage', () => {
  it('tracks the reads and writes made through Dexie', async () => {
    const database = new SwuDatabase('storage-health-test');
    const track = vi.fn(<T>(request: Promise<T>) => request);
    database.use(watchStorage({ track }));
    await database.meta.put({ key: 'a', value: '1' });
    expect(await database.meta.get('a')).toEqual({ key: 'a', value: '1' });
    expect(track).toHaveBeenCalledTimes(2);
    database.close();
    await database.delete();
  });
});

describe('startInstanceWatch', () => {
  /** A Web Locks stand-in: `held` is what `query` lists besides the locks requested here. */
  function fakeLocks(held: string[]) {
    const mine: string[] = [];
    return {
      request: vi.fn((name: string, callback: () => Promise<void>) => {
        mine.push(name);
        return callback();
      }),
      query: vi.fn(async () => ({ held: [...held, ...mine].map((name) => ({ name })) })),
    } as unknown as LockManager;
  }

  it('counts the other copies holding an instance lock, and only those', async () => {
    const setOthers = vi.fn();
    const stop = startInstanceWatch(
      { setOthers },
      {
        locks: fakeLocks([
          'swu-organizer:instance:other-tab',
          'swu-organizer:instance:frozen-tab',
          'something-else',
        ]),
      },
    );
    await vi.waitFor(() => expect(setOthers).toHaveBeenCalledWith(2));
    stop();
  });

  it('counts none when this is the only copy', async () => {
    const setOthers = vi.fn();
    const stop = startInstanceWatch({ setOthers }, { locks: fakeLocks([]) });
    await vi.waitFor(() => expect(setOthers).toHaveBeenCalledWith(0));
    stop();
  });

  it('does nothing without Web Locks', () => {
    const setOthers = vi.fn();
    startInstanceWatch({ setOthers }, { locks: undefined })();
    expect(setOthers).not.toHaveBeenCalled();
  });
});
