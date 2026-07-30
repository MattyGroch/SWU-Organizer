import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createDeckSync, type BroadcastPayload, type DeckSync, type DeckSyncEvent } from './deckSync'
import type { DeckLibrary } from './decks'

function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() {
      return map.size
    },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => {
      map.delete(k)
    },
    setItem: (k: string, v: string) => {
      map.set(k, String(v))
    },
  }
}

type FetchStep = { status: number; json?: unknown }

function makeFetch(steps: FetchStep[]) {
  const calls: Array<{ url: string; init?: RequestInit }> = []
  let i = 0
  const fetchFn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input.toString()
    calls.push({ url, init })
    const step = steps[i++]
    if (!step) throw new Error(`unexpected fetch: ${url}`)
    return {
      ok: step.status >= 200 && step.status < 300,
      status: step.status,
      json: async () => step.json ?? {},
    } as unknown as Response
  })
  return { fetchFn, calls }
}

function fakeBroadcast() {
  let handler: ((payload: BroadcastPayload) => void) | null = null
  const posted: BroadcastPayload[] = []
  return {
    posted,
    api: {
      postMessage: (event: BroadcastPayload) => {
        posted.push(event)
      },
      onMessage: (fn: (payload: BroadcastPayload) => void) => {
        handler = fn
        return () => {
          handler = null
        }
      },
    },
    deliver: (payload: BroadcastPayload) => handler?.(payload),
  }
}

const library: DeckLibrary = { customDecks: [], preconOwnership: { 'SOR-heroism': 1 } }

let sync: DeckSync | null = null

afterEach(() => {
  sync?.dispose()
  sync = null
})

describe('deckSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces push and clears pending on success', async () => {
    const storage = memoryStorage()
    const { fetchFn, calls } = makeFetch([{ status: 200, json: { version: 1 } }])
    sync = createDeckSync({ storage, fetch: fetchFn })
    sync.setSignedIn(true)

    sync.scheduleSync({ ...library, preconOwnership: { a: 1 } })
    sync.scheduleSync({ ...library, preconOwnership: { a: 1, b: 1 } })

    await vi.advanceTimersByTimeAsync(1000)
    await vi.runOnlyPendingTimersAsync()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const body = JSON.parse((calls[0]!.init!.body as string) || '{}')
    expect(body).toEqual({ data: { customDecks: [], preconOwnership: { a: 1, b: 1 } } })

    const state = sync.getState()
    expect(state.pending).toBeNull()
    expect(state.version).toBe(1)
  })

  it('persists pending edit when offline and flushes after signIn', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([{ status: 200, json: { version: 1 } }])
    sync = createDeckSync({ storage, fetch: fetchFn })

    sync.scheduleSync(library)
    expect(sync.getState().pending).toEqual(library)
    expect(fetchFn).not.toHaveBeenCalled()

    sync.setSignedIn(true)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(sync.getState().pending).toBeNull()
  })

  it('emits signout event and stops pushing on 401', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([{ status: 401 }])
    sync = createDeckSync({ storage, fetch: fetchFn })
    const events: DeckSyncEvent[] = []
    sync.subscribe(e => events.push(e))
    sync.setSignedIn(true)

    sync.scheduleSync(library)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runOnlyPendingTimersAsync()

    expect(events.some(e => e.type === 'signout')).toBe(true)
    expect(sync.getState().pending).toEqual(library)
  })

  it('applies server version on 409 and calls onLocalApply', async () => {
    const storage = memoryStorage()
    const serverLibrary: DeckLibrary = { customDecks: [], preconOwnership: { c: 1 } }
    const { fetchFn } = makeFetch([
      { status: 409, json: { current: { data: serverLibrary, version: 7 } } },
    ])
    const onLocalApply = vi.fn()
    sync = createDeckSync({ storage, fetch: fetchFn, onLocalApply })
    const events: DeckSyncEvent[] = []
    sync.subscribe(e => events.push(e))
    sync.setSignedIn(true)

    sync.scheduleSync(library)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runOnlyPendingTimersAsync()

    expect(onLocalApply).toHaveBeenCalledWith(serverLibrary)
    expect(sync.getState().version).toBe(7)
    expect(sync.getState().pending).toBeNull()
    expect(events.some(e => e.type === 'pulled')).toBe(true)
  })

  it('retries with backoff on 5xx and reports error after 3 attempts', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([{ status: 500 }, { status: 500 }, { status: 500 }])
    sync = createDeckSync({ storage, fetch: fetchFn })
    const errors: DeckSyncEvent[] = []
    sync.subscribe(e => {
      if (e.type === 'error') errors.push(e)
    })
    sync.setSignedIn(true)

    sync.scheduleSync(library)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(1000)
    await vi.advanceTimersByTimeAsync(2000)

    expect(fetchFn).toHaveBeenCalledTimes(3)
    expect(errors.length).toBeGreaterThanOrEqual(1)
    const last = errors[errors.length - 1]!
    if (last.type === 'error') expect(last.consecutive).toBeGreaterThanOrEqual(3)
  })

  it('applies broadcast messages from other tabs', () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([])
    const bc = fakeBroadcast()
    const onLocalApply = vi.fn()
    sync = createDeckSync({ storage, fetch: fetchFn, broadcast: bc.api, onLocalApply })
    sync.setSignedIn(true)

    bc.deliver({ type: 'pushed', data: library, version: 4 })
    expect(onLocalApply).toHaveBeenCalledWith(library)
    expect(sync.getState().version).toBe(4)
  })

  it('pull returns server state and updates the local version', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([
      { status: 200, json: { data: library, version: 2, updatedAt: 100 } },
    ])
    sync = createDeckSync({ storage, fetch: fetchFn })
    sync.setSignedIn(true)

    const result = await sync.pull()
    expect(result).toEqual({ data: library, version: 2 })
    expect(sync.getState().version).toBe(2)
  })

  it('pull returns null and signs out on 401', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([{ status: 401 }])
    sync = createDeckSync({ storage, fetch: fetchFn })
    const events: DeckSyncEvent[] = []
    sync.subscribe(e => events.push(e))
    sync.setSignedIn(true)

    const result = await sync.pull()
    expect(result).toBeNull()
    expect(events.some(e => e.type === 'signout')).toBe(true)
  })

  it('pull returns null when signed out', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([])
    sync = createDeckSync({ storage, fetch: fetchFn })

    expect(await sync.pull()).toBeNull()
    expect(fetchFn).not.toHaveBeenCalled()
  })

  it('starts with an empty pending/version state and no-ops flushDirty when nothing pending', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([])
    sync = createDeckSync({ storage, fetch: fetchFn })
    sync.setSignedIn(true)
    expect(sync.getState()).toEqual({ version: 0, pending: null })
    await sync.flushDirty()
    expect(fetchFn).not.toHaveBeenCalled()
  })
})
