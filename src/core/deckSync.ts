import { emptyDeckLibrary, type DeckLibrary } from './decks'

export type DeckSyncStatus = 'off' | 'idle' | 'pushing' | 'error' | 'offline'

export type DeckSyncEvent =
  | { type: 'pulled'; data: DeckLibrary; version: number }
  | { type: 'pushed'; version: number }
  | { type: 'signout' }
  | { type: 'status'; status: DeckSyncStatus }
  | { type: 'error'; consecutive: number; message: string }

export type DeckSyncListener = (event: DeckSyncEvent) => void

export type DeckSyncState = {
  version: number
  pending: DeckLibrary | null
}

const STATE_KEY = 'deckSync:state'
const RETRY_MS = [1000, 2000, 5000, 15000, 60000] as const
const DEBOUNCE_MS = 1000

const emptyState: DeckSyncState = { version: 0, pending: null }

function readState(storage: Pick<Storage, 'getItem'>): DeckSyncState {
  try {
    const raw = storage.getItem(STATE_KEY)
    if (!raw) return { ...emptyState }
    const parsed = JSON.parse(raw) as Partial<DeckSyncState>
    return { version: parsed.version ?? 0, pending: parsed.pending ?? null }
  } catch {
    return { ...emptyState }
  }
}

function writeState(storage: Pick<Storage, 'setItem'>, state: DeckSyncState): void {
  try {
    storage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    // If storage is full or blocked, we lose the sync intent — nothing to do.
  }
}

export type DeckSyncDeps = {
  storage: Storage
  fetch: typeof fetch
  now?: () => number
  setTimeoutFn?: (fn: () => void, ms: number) => number
  clearTimeoutFn?: (id: number) => void
  broadcast?: {
    postMessage: (event: BroadcastPayload) => void
    onMessage: (handler: (event: BroadcastPayload) => void) => () => void
  } | null
  onLocalApply?: (data: DeckLibrary) => void
}

export type BroadcastPayload =
  | { type: 'pushed'; data: DeckLibrary; version: number }
  | { type: 'pulled'; data: DeckLibrary; version: number }

export type DeckSync = ReturnType<typeof createDeckSync>

export function createDeckSync(deps: DeckSyncDeps) {
  const now = deps.now ?? (() => Date.now())
  const schedule = deps.setTimeoutFn ?? ((fn: () => void, ms: number) =>
    (setTimeout(fn, ms) as unknown) as number)
  const cancel = deps.clearTimeoutFn ?? ((id: number) => clearTimeout(id))

  const listeners = new Set<DeckSyncListener>()
  let debounceTimer: number | null = null
  let retryTimer: number | null = null
  let retryAttempt = 0
  let inFlight = false

  let signedIn = false
  let currentStatus: DeckSyncStatus = 'off'

  const bcUnsub = deps.broadcast?.onMessage(handleBroadcast)

  function emit(event: DeckSyncEvent) {
    for (const listener of listeners) listener(event)
  }

  function setStatus(next: DeckSyncStatus) {
    if (next === currentStatus) return
    currentStatus = next
    emit({ type: 'status', status: next })
  }

  function subscribe(listener: DeckSyncListener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function getState(): DeckSyncState {
    return readState(deps.storage)
  }

  function mutate(patch: (s: DeckSyncState) => DeckSyncState): DeckSyncState {
    const next = patch(readState(deps.storage))
    writeState(deps.storage, next)
    return next
  }

  function setSignedIn(value: boolean): void {
    signedIn = value
    if (!value) {
      setStatus('off')
      return
    }
    setStatus('idle')
    flushDirty().catch(() => {
      /* errors surface via events */
    })
  }

  function scheduleSync(data: DeckLibrary): void {
    const snapshot = { customDecks: [...data.customDecks], preconOwnership: { ...data.preconOwnership } }
    mutate(s => ({ ...s, pending: snapshot }))
    if (debounceTimer != null) cancel(debounceTimer)
    if (!signedIn) return
    debounceTimer = schedule(() => {
      debounceTimer = null
      void push().catch(() => {})
    }, DEBOUNCE_MS)
  }

  async function push(): Promise<void> {
    if (!signedIn) return
    if (inFlight) return
    const state = readState(deps.storage)
    const data = state.pending
    if (!data) return
    inFlight = true
    setStatus('pushing')
    const version = state.version
    try {
      const res = await deps.fetch('/api/decks', {
        method: 'PUT',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          'if-match': String(version),
        },
        body: JSON.stringify({ data }),
      })
      if (res.status === 401) {
        signedIn = false
        setStatus('off')
        emit({ type: 'signout' })
        return
      }
      if (res.status === 409) {
        const body = await res.json().catch(() => ({}))
        const current = body?.current as { data?: DeckLibrary; version?: number } | undefined
        if (current && typeof current.version === 'number') {
          applyServerVersion(current.data ?? emptyDeckLibrary, current.version)
        }
        retryAttempt = 0
        setStatus('idle')
        return
      }
      if (res.status >= 500) {
        throw new Error(`sync_5xx_${res.status}`)
      }
      if (!res.ok) {
        throw new Error(`sync_failed_${res.status}`)
      }
      const body = (await res.json()) as { version: number }
      mutate(s => ({ ...s, pending: null, version: body.version }))
      retryAttempt = 0
      setStatus('idle')
      emit({ type: 'pushed', version: body.version })
      deps.broadcast?.postMessage({ type: 'pushed', data, version: body.version })
    } catch (err) {
      retryAttempt += 1
      const delay = RETRY_MS[Math.min(retryAttempt - 1, RETRY_MS.length - 1)] ?? RETRY_MS[RETRY_MS.length - 1]!
      if (retryTimer != null) cancel(retryTimer)
      retryTimer = schedule(() => {
        retryTimer = null
        void push().catch(() => {})
      }, delay)
      setStatus('error')
      if (retryAttempt >= 3) {
        emit({
          type: 'error',
          consecutive: retryAttempt,
          message: err instanceof Error ? err.message : 'sync_error',
        })
      }
    } finally {
      inFlight = false
    }
  }

  function applyServerVersion(data: DeckLibrary, version: number): void {
    mutate(s => ({ ...s, pending: null, version }))
    deps.onLocalApply?.(data)
    emit({ type: 'pulled', data, version })
    deps.broadcast?.postMessage({ type: 'pulled', data, version })
  }

  async function pull(): Promise<{ data: DeckLibrary; version: number } | null> {
    if (!signedIn) return null
    const res = await deps.fetch('/api/decks', {
      method: 'GET',
      credentials: 'include',
    })
    if (res.status === 401) {
      signedIn = false
      setStatus('off')
      emit({ type: 'signout' })
      return null
    }
    if (!res.ok) return null
    const body = (await res.json()) as { data: DeckLibrary; version: number; updatedAt: number }
    mutate(s => ({ ...s, version: body.version }))
    return { data: body.data, version: body.version }
  }

  async function flushDirty(): Promise<void> {
    if (!signedIn) return
    if (readState(deps.storage).pending) await push().catch(() => {})
  }

  function handleBroadcast(payload: BroadcastPayload): void {
    if (payload.type !== 'pushed' && payload.type !== 'pulled') return
    mutate(s => ({ ...s, pending: null, version: payload.version }))
    deps.onLocalApply?.(payload.data)
    emit({ type: 'pulled', data: payload.data, version: payload.version })
  }

  function dispose(): void {
    if (debounceTimer != null) cancel(debounceTimer)
    if (retryTimer != null) cancel(retryTimer)
    debounceTimer = null
    retryTimer = null
    listeners.clear()
    bcUnsub?.()
  }

  function status(): DeckSyncStatus {
    return currentStatus
  }

  return {
    subscribe,
    scheduleSync,
    pull,
    flushDirty,
    setSignedIn,
    getState,
    status,
    dispose,
  }
}

export function makeDeckBroadcast(): DeckSyncDeps['broadcast'] {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel('swu-deck-sync')
  return {
    postMessage: event => channel.postMessage(event),
    onMessage: handler => {
      const listener = (ev: MessageEvent<BroadcastPayload>) => handler(ev.data)
      channel.addEventListener('message', listener)
      return () => channel.removeEventListener('message', listener)
    },
  }
}
