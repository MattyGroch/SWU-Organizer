import type { DBCore, DBCoreTable, Middleware } from 'dexie';

/**
 * Whether the app's storage is answering — and whether another copy of the app is open.
 *
 * IndexedDB never times out. When another copy of the app holds it (a Chrome tab Android
 * froze mid-write, while the installed app is in use), every read and write here waits
 * forever: pages sit on their loading state, the scanner recognises cards and records
 * nothing, and Dexie's optimistic live queries can even count writes that never land.
 * Nothing errors, so without this the app just looks broken.
 */

/** A request still pending after this long is stuck, not slow. */
export const STALL_MS = 4000;

export type StorageHealth = {
  /** Some storage request has gone unanswered for STALL_MS. */
  stalled: boolean;
  /** Other copies of the app open on this device (tabs, windows, the installed app). */
  others: number;
};

type Listener = () => void;

export type HealthStore = {
  get: () => StorageHealth;
  subscribe: (listener: Listener) => () => void;
  /** Watches one storage request until it settles. */
  track: <T>(request: Promise<T>) => Promise<T>;
  setOthers: (others: number) => void;
};

export function createHealthStore({
  stallMs = STALL_MS,
  now = () => Date.now(),
}: { stallMs?: number; now?: () => number } = {}): HealthStore {
  let health: StorageHealth = { stalled: false, others: 0 };
  const listeners = new Set<Listener>();
  /** Start times of the requests still pending. */
  const pending = new Map<number, number>();
  let nextId = 0;
  let timer: ReturnType<typeof setInterval> | undefined;

  const set = (next: Partial<StorageHealth>) => {
    if (Object.entries(next).every(([k, v]) => health[k as keyof StorageHealth] === v)) return;
    health = { ...health, ...next };
    for (const listener of listeners) listener();
  };

  /** Stalled while the oldest pending request is older than stallMs. */
  const check = () => {
    const oldest = Math.min(...pending.values());
    set({ stalled: pending.size > 0 && now() - oldest >= stallMs });
    if (!pending.size && timer !== undefined) {
      clearInterval(timer);
      timer = undefined;
    }
  };

  return {
    get: () => health,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    track(request) {
      const id = nextId++;
      pending.set(id, now());
      timer ??= setInterval(check, Math.min(1000, stallMs / 2));
      const settle = () => {
        pending.delete(id);
        check();
      };
      request.then(settle, settle);
      return request;
    },
    setOthers: (others) => set({ others }),
  };
}

/** The app's own store, fed by the `db` middleware and the instance watch. */
export const storageHealth = createHealthStore();

/** A Dexie middleware that hands every table request to `store.track`. */
export function watchStorage(store: Pick<HealthStore, 'track'>): Middleware<DBCore> {
  return {
    stack: 'dbcore',
    name: 'storageHealth',
    create: (down) => ({
      ...down,
      table(name) {
        const table = down.table(name);
        const watched: DBCoreTable = {
          ...table,
          get: (req) => store.track(table.get(req)),
          getMany: (req) => store.track(table.getMany(req)),
          query: (req) => store.track(table.query(req)),
          openCursor: (req) => store.track(table.openCursor(req)),
          count: (req) => store.track(table.count(req)),
          mutate: (req) => store.track(table.mutate(req)),
        };
        return watched;
      },
    }),
  };
}

const INSTANCE_LOCK = 'swu-organizer:instance:';

/**
 * Counts the other copies of the app open on this device, into `store.setOthers`.
 *
 * Each copy holds a Web Lock for as long as it is open. Unlike messages, a lock is still
 * listed while its page is frozen in the background — and a frozen copy is exactly the
 * one that can lock up storage. Without Web Locks it does nothing.
 */
export function startInstanceWatch(
  store: Pick<HealthStore, 'setOthers'>,
  { locks = globalThis.navigator?.locks, recheckMs = 15_000 } = {},
): () => void {
  if (!locks) return () => {};
  const name = `${INSTANCE_LOCK}${crypto.randomUUID()}`;
  let release: () => void = () => {};
  let stopped = false;
  const channel = 'BroadcastChannel' in globalThis ? new BroadcastChannel(INSTANCE_LOCK) : null;

  const recount = async () => {
    if (stopped) return;
    const { held = [] } = await locks.query();
    const others = held.filter(
      (lock) => lock.name?.startsWith(INSTANCE_LOCK) && lock.name !== name,
    );
    if (!stopped) store.setOthers(others.length);
  };
  /** Recounts now, and again once a copy that is closing has let go of its lock. */
  const recountSoon = () => {
    void recount();
    setTimeout(() => void recount(), 1000);
  };

  void locks
    .request(name, () => {
      void recount();
      // A copy that opens or closes says so, so the others recount at once.
      channel?.postMessage('changed');
      return new Promise<void>((resolve) => (release = resolve));
    })
    .catch(() => {});

  const onVisible = () => {
    if (document.visibilityState === 'visible') void recount();
  };
  const onHide = () => channel?.postMessage('changed');
  if (channel) channel.onmessage = recountSoon;
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('pagehide', onHide);
  const timer = setInterval(() => void recount(), recheckMs);

  return () => {
    stopped = true;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    window.removeEventListener('pagehide', onHide);
    release();
    channel?.postMessage('changed');
    channel?.close();
  };
}
