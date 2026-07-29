import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createCloudSync,
  type BroadcastPayload,
  type CloudSync,
  type SyncEvent,
} from './cloudSync'

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

type FetchStep = {
  status: number
  json?: unknown
}

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

let sync: CloudSync | null = null

afterEach(() => {
  sync?.dispose()
  sync = null
})

describe('cloudSync', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('debounces push per set and clears pending on success', async () => {
    const storage = memoryStorage()
    const { fetchFn, calls } = makeFetch([{ status: 200, json: { version: 1 } }])
    sync = createCloudSync({ storage, fetch: fetchFn })
    sync.setSignedIn(true)

    sync.scheduleSync('SOR', { 1: 1 })
    sync.scheduleSync('SOR', { 1: 2 })
    sync.scheduleSync('SOR', { 1: 3 })

    await vi.advanceTimersByTimeAsync(1000)
    await vi.runOnlyPendingTimersAsync()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    const body = JSON.parse((calls[0]!.init!.body as string) || '{}')
    expect(body).toEqual({ data: { 1: 3 } })

    const state = sync.getState()
    expect(state.pending).toEqual({})
    expect(state.versions.SOR).toBe(1)
  })

  it('persists pending edit when offline and flushes after signIn', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([{ status: 200, json: { version: 1 } }])
    sync = createCloudSync({ storage, fetch: fetchFn })

    // Not signed in yet — should still record pending.
    sync.scheduleSync('SOR', { 5: 3 })
    expect(sync.getState().pending.SOR).toEqual({ 5: 3 })
    expect(fetchFn).not.toHaveBeenCalled()

    sync.setSignedIn(true)
    await vi.runOnlyPendingTimersAsync()
    await Promise.resolve()

    expect(fetchFn).toHaveBeenCalledTimes(1)
    expect(sync.getState().pending).toEqual({})
  })

  it('emits signout event and stops pushing on 401', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([{ status: 401 }])
    sync = createCloudSync({ storage, fetch: fetchFn })
    const events: SyncEvent[] = []
    sync.subscribe(e => events.push(e))
    sync.setSignedIn(true)

    sync.scheduleSync('SOR', { 1: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runOnlyPendingTimersAsync()

    expect(events.some(e => e.type === 'signout')).toBe(true)
    expect(sync.getState().pending.SOR).toEqual({ 1: 1 })
  })

  it('applies server version on 409 and calls onLocalApply', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([
      { status: 409, json: { current: { data: { 3: 3 }, version: 7 } } },
    ])
    const onLocalApply = vi.fn()
    sync = createCloudSync({ storage, fetch: fetchFn, onLocalApply })
    const events: SyncEvent[] = []
    sync.subscribe(e => events.push(e))
    sync.setSignedIn(true)

    sync.scheduleSync('SOR', { 3: 1 })
    await vi.advanceTimersByTimeAsync(1000)
    await vi.runOnlyPendingTimersAsync()

    expect(onLocalApply).toHaveBeenCalledWith('SOR', { 3: 3 })
    expect(sync.getState().versions.SOR).toBe(7)
    expect(sync.getState().pending).toEqual({})
    expect(events.some(e => e.type === 'pulled')).toBe(true)
  })

  it('retries with backoff on 5xx and reports error after 3 attempts', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([
      { status: 500 },
      { status: 500 },
      { status: 500 },
    ])
    sync = createCloudSync({ storage, fetch: fetchFn })
    const errors: SyncEvent[] = []
    sync.subscribe(e => {
      if (e.type === 'error') errors.push(e)
    })
    sync.setSignedIn(true)

    sync.scheduleSync('SOR', { 1: 1 })
    // Debounce fires push #1 at t=1000. It returns 500 → retry scheduled at t=2000.
    await vi.advanceTimersByTimeAsync(1000)
    // Retry #1 fires push #2 at t=2000. It returns 500 → retry scheduled at t=4000.
    await vi.advanceTimersByTimeAsync(1000)
    // Retry #2 fires push #3 at t=4000. Do not advance further — the next retry
    // sits at t=9000 and would be an unwanted 4th call.
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
    sync = createCloudSync({
      storage,
      fetch: fetchFn,
      broadcast: bc.api,
      onLocalApply,
    })
    sync.setSignedIn(true)

    bc.deliver({ type: 'pushed', setKey: 'SOR', data: { 7: 3 }, version: 4 })
    expect(onLocalApply).toHaveBeenCalledWith('SOR', { 7: 3 })
    expect(sync.getState().versions.SOR).toBe(4)
  })

  it('pullAll updates versions and returns server state', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([
      {
        status: 200,
        json: {
          sets: {
            SOR: { data: { 1: 1 }, version: 2, updatedAt: 100 },
            SHD: { data: { 5: 3 }, version: 1, updatedAt: 100 },
          },
        },
      },
    ])
    sync = createCloudSync({ storage, fetch: fetchFn })
    sync.setSignedIn(true)

    const result = await sync.pullAll()
    expect(result.SOR).toEqual({ data: { 1: 1 }, version: 2 })
    expect(sync.getState().versions).toEqual({ SOR: 2, SHD: 1 })
  })

  it('pushAll (bulk migration) resets pending and versions', async () => {
    const storage = memoryStorage()
    const { fetchFn } = makeFetch([
      {
        status: 200,
        json: {
          sets: {
            SOR: { data: { 1: 1 }, version: 1, updatedAt: 100 },
          },
        },
      },
    ])
    sync = createCloudSync({ storage, fetch: fetchFn })
    sync.setSignedIn(true)
    sync.scheduleSync('SOR', { 1: 1 })

    await sync.pushAll({ SOR: { 1: 1 } })
    expect(sync.getState().pending).toEqual({})
    expect(sync.getState().versions.SOR).toBe(1)
  })
})
