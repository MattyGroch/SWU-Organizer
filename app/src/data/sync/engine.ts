/**
 * One sync engine for every synced resource.
 *
 * The legacy app had two of these — `cloudSync.ts` (369 lines, keyed by set) and
 * `deckSync.ts` (271 lines, a single record) — which were structurally the same program:
 * the same status enum, the same event shapes, the same debounce / BroadcastChannel /
 * version / dirty-flush / signout machinery, duplicated and already drifting apart.
 *
 * Here the key is just a string. Inventories use the set key; the deck library uses a
 * single fixed key. Everything else is shared.
 */

export type SyncStatus = 'off' | 'idle' | 'pushing' | 'error' | 'offline';

export type SyncEvent<T> =
  | { type: 'status'; status: SyncStatus }
  | { type: 'pulled'; key: string; data: T; version: number }
  | { type: 'pushed'; key: string; version: number }
  | { type: 'signout' }
  | { type: 'error'; key: string; consecutive: number; message: string };

export type SyncListener<T> = (event: SyncEvent<T>) => void;

export type SyncState<T> = {
  versions: Record<string, number>;
  /** Writes not yet accepted by the server. Persisted, so a reload cannot lose them. */
  pending: Record<string, T>;
  /**
   * The last copy this device and the server agreed on, per key — the common ancestor a
   * three-way merge needs to tell "added here" from "removed there".
   */
  base: Record<string, T>;
  lastPulledAt: number;
};

export type BroadcastPayload<T> = { key: string; data: T; version: number };

export type BroadcastPort<T> = {
  postMessage: (payload: BroadcastPayload<T>) => void;
  onMessage: (handler: (payload: BroadcastPayload<T>) => void) => () => void;
};

export type SyncEngineOptions<T> = {
  /** Namespaces the persisted state key and the broadcast channel. */
  name: string;
  /** URL of a single record, e.g. `/api/inventories/SOR`. */
  recordUrl: (key: string) => string;
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  fetch: typeof fetch;
  /** Applies a server-authoritative value locally (conflict resolution, other tabs). */
  onApply: (key: string, data: T) => void | Promise<void>;
  broadcast?: BroadcastPort<T> | null;
  now?: () => number;
  setTimeoutFn?: (fn: () => void, ms: number) => number;
  clearTimeoutFn?: (id: number) => void;
  isOnline?: () => boolean;
  debounceMs?: number;
  retrySchedule?: readonly number[];
  /**
   * Combines an unsent local write with a newer server copy. Without it the server's copy
   * wins outright and the local write is dropped; with it, both changes survive.
   */
  merge?: (local: T, remote: T, base: T | undefined) => T;
};

const DEFAULT_RETRY_MS = [1000, 2000, 5000, 15000, 60000] as const;
const DEFAULT_DEBOUNCE_MS = 1000;

function emptyState<T>(): SyncState<T> {
  return { versions: {}, pending: {}, base: {}, lastPulledAt: 0 };
}

export type SyncEngine<T> = ReturnType<typeof createSyncEngine<T>>;

export function createSyncEngine<T>(options: SyncEngineOptions<T>) {
  const stateKey = `sync:${options.name}`;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const retrySchedule = options.retrySchedule ?? DEFAULT_RETRY_MS;
  const now = options.now ?? (() => Date.now());
  const schedule =
    options.setTimeoutFn ??
    ((fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number);
  const cancel = options.clearTimeoutFn ?? ((id: number) => clearTimeout(id));
  const isOnline = options.isOnline ?? (() => true);

  const listeners = new Set<SyncListener<T>>();
  const debounceTimers = new Map<string, number>();
  const retryTimers = new Map<string, number>();
  const retryAttempts = new Map<string, number>();
  const inFlight = new Set<string>();

  let signedIn = false;
  let status: SyncStatus = 'off';

  const unsubscribeBroadcast = options.broadcast?.onMessage(onBroadcast);

  function readState(): SyncState<T> {
    try {
      const raw = options.storage.getItem(stateKey);
      if (!raw) return emptyState<T>();
      const parsed = JSON.parse(raw) as Partial<SyncState<T>>;
      return {
        versions: parsed.versions ?? {},
        pending: parsed.pending ?? {},
        base: parsed.base ?? {},
        lastPulledAt: parsed.lastPulledAt ?? 0,
      };
    } catch {
      return emptyState<T>();
    }
  }

  function mutate(patch: (state: SyncState<T>) => SyncState<T>): SyncState<T> {
    const next = patch(readState());
    try {
      options.storage.setItem(stateKey, JSON.stringify(next));
    } catch {
      // Storage full or blocked. The in-memory timers still fire, so this run can
      // succeed; only durability across a reload is lost.
    }
    return next;
  }

  function emit(event: SyncEvent<T>): void {
    for (const listener of listeners) listener(event);
  }

  function setStatus(next: SyncStatus): void {
    if (next === status) return;
    status = next;
    emit({ type: 'status', status: next });
  }

  /** The server now holds `agreed` at `version`: nothing is left to send for this key. */
  function clearPending(key: string, version: number, agreed: T): void {
    mutate((state) => {
      const pending = { ...state.pending };
      delete pending[key];
      return {
        ...state,
        pending,
        versions: { ...state.versions, [key]: version },
        base: { ...state.base, [key]: agreed },
      };
    });
  }

  /**
   * A newer server copy arrived while this device still has an unsent write. Merges the
   * two, shows the result locally, and queues it to go back up at the server's version.
   * Returns false when no merge is configured, leaving the caller to let the server win.
   */
  async function mergeWithRemote(key: string, remote: T, version: number): Promise<boolean> {
    const state = readState();
    const local = state.pending[key];
    if (!options.merge || local === undefined) return false;

    const merged = options.merge(local, remote, state.base[key]);
    await options.onApply(key, merged);
    mutate((s) => ({
      ...s,
      versions: { ...s.versions, [key]: version },
      base: { ...s.base, [key]: remote },
      pending: { ...s.pending, [key]: merged },
    }));
    emit({ type: 'pulled', key, data: merged, version });
    return true;
  }

  function handleSignout(): void {
    signedIn = false;
    setStatus('off');
    emit({ type: 'signout' });
  }

  /** Records a write and schedules a debounced push. Safe to call while signed out. */
  function queue(key: string, data: T): void {
    mutate((state) => ({ ...state, pending: { ...state.pending, [key]: data } }));

    const existing = debounceTimers.get(key);
    if (existing !== undefined) cancel(existing);
    if (!signedIn) return;

    debounceTimers.set(
      key,
      schedule(() => {
        debounceTimers.delete(key);
        void push(key);
      }, debounceMs),
    );
  }

  function scheduleRetry(key: string, message: string): void {
    const attempt = (retryAttempts.get(key) ?? 0) + 1;
    retryAttempts.set(key, attempt);

    const delay = retrySchedule[Math.min(attempt - 1, retrySchedule.length - 1)] ?? 60000;
    const existing = retryTimers.get(key);
    if (existing !== undefined) cancel(existing);
    retryTimers.set(
      key,
      schedule(() => {
        retryTimers.delete(key);
        void push(key);
      }, delay),
    );

    setStatus(isOnline() ? 'error' : 'offline');
    // Only surface a notification once a failure looks persistent rather than transient.
    if (attempt >= 3) emit({ type: 'error', key, consecutive: attempt, message });
  }

  async function push(key: string): Promise<void> {
    if (!signedIn || inFlight.has(key)) return;

    const state = readState();
    const data = state.pending[key];
    if (data === undefined) return;

    if (!isOnline()) {
      setStatus('offline');
      scheduleRetry(key, 'offline');
      return;
    }

    inFlight.add(key);
    setStatus('pushing');
    let pushAgain = false;

    try {
      const response = await options.fetch(options.recordUrl(key), {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'if-match': String(state.versions[key] ?? 0),
        },
        body: JSON.stringify({ data }),
      });

      if (response.status === 401) {
        handleSignout();
        return;
      }

      // Someone else wrote first. The server's copy wins; adopt it and drop our pending
      // write rather than clobbering a change made on another device.
      if (response.status === 409) {
        const body = (await response.json().catch(() => ({}))) as {
          current?: { data?: T; version?: number };
        };
        const current = body.current;
        if (current && typeof current.version === 'number' && current.data !== undefined) {
          if (await mergeWithRemote(key, current.data, current.version)) {
            pushAgain = true;
          } else {
            await applyRemote(key, current.data, current.version);
          }
        }
        retryAttempts.delete(key);
        setStatus('idle');
        return;
      }

      if (!response.ok) throw new Error(`sync_failed_${response.status}`);

      const body = (await response.json()) as { version: number };
      // Only settle if nothing newer was queued while this request was in flight.
      // State is re-read from storage, so compare by content, not identity.
      if (JSON.stringify(readState().pending[key]) === JSON.stringify(data)) {
        clearPending(key, body.version, data);
      } else {
        mutate((s) => ({
          ...s,
          versions: { ...s.versions, [key]: body.version },
          base: { ...s.base, [key]: data },
        }));
      }
      retryAttempts.delete(key);
      setStatus('idle');
      emit({ type: 'pushed', key, version: body.version });
      options.broadcast?.postMessage({ key, data, version: body.version });
    } catch (error) {
      scheduleRetry(key, error instanceof Error ? error.message : 'sync_error');
    } finally {
      inFlight.delete(key);
      if (pushAgain) void push(key);
    }
  }

  async function applyRemote(key: string, data: T, version: number): Promise<void> {
    clearPending(key, version, data);
    await options.onApply(key, data);
    emit({ type: 'pulled', key, data, version });
    options.broadcast?.postMessage({ key, data, version });
  }

  function onBroadcast(payload: BroadcastPayload<T>): void {
    // Another tab already persisted this; adopt its version without re-broadcasting.
    clearPending(payload.key, payload.version, payload.data);
    void options.onApply(payload.key, payload.data);
    emit({ type: 'pulled', key: payload.key, data: payload.data, version: payload.version });
  }

  function setSignedIn(value: boolean): void {
    signedIn = value;
    if (!value) {
      setStatus('off');
      return;
    }
    setStatus('idle');
    void flush();
  }

  /**
   * Takes in a server copy from a pull. Ignored unless it is newer than what this device
   * last saw; applied directly when nothing local is pending; merged when something is
   * (or, with no merge configured, left for the next push to resolve).
   */
  async function receive(key: string, data: T, version: number): Promise<void> {
    const state = readState();
    if (version <= (state.versions[key] ?? 0)) return;
    if (state.pending[key] === undefined) {
      await applyRemote(key, data, version);
      return;
    }
    if (await mergeWithRemote(key, data, version)) void push(key);
  }

  /** Pushes every queued write. Called on sign-in and when connectivity returns. */
  async function flush(): Promise<void> {
    if (!signedIn) return;
    await Promise.all(Object.keys(readState().pending).map((key) => push(key)));
  }

  /** Notes what the server holds for a key, without changing anything locally. */
  function recordServer(key: string, data: T, version: number): void {
    mutate((state) => ({
      ...state,
      versions: { ...state.versions, [key]: version },
      base: { ...state.base, [key]: data },
    }));
  }

  /** Shows `data` locally without treating it as agreed with the server. */
  async function applyLocal(key: string, data: T): Promise<void> {
    await options.onApply(key, data);
  }

  function recordVersion(key: string, version: number): void {
    mutate((state) => ({ ...state, versions: { ...state.versions, [key]: version } }));
  }

  function markPulled(): void {
    mutate((state) => ({ ...state, lastPulledAt: now() }));
  }

  function dispose(): void {
    for (const id of debounceTimers.values()) cancel(id);
    for (const id of retryTimers.values()) cancel(id);
    debounceTimers.clear();
    retryTimers.clear();
    listeners.clear();
    unsubscribeBroadcast?.();
  }

  return {
    queue,
    flush,
    push,
    applyRemote,
    receive,
    recordServer,
    applyLocal,
    setSignedIn,
    recordVersion,
    markPulled,
    dispose,
    getState: readState,
    getStatus: () => status,
    hasPending: () => Object.keys(readState().pending).length > 0,
    subscribe(listener: SyncListener<T>): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function makeBroadcastPort<T>(name: string): BroadcastPort<T> | null {
  if (typeof BroadcastChannel === 'undefined') return null;
  const channel = new BroadcastChannel(`swu-${name}`);
  return {
    postMessage: (payload) => channel.postMessage(payload),
    onMessage: (handler) => {
      const listener = (event: MessageEvent<BroadcastPayload<T>>) => handler(event.data);
      channel.addEventListener('message', listener);
      return () => channel.removeEventListener('message', listener);
    },
  };
}
