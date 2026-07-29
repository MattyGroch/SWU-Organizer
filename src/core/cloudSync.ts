import type { Inventory, SetKey } from './types'

export type SyncStatus = 'off' | 'idle' | 'pushing' | 'error' | 'offline'

export type SyncEvent =
  | { type: 'pulled'; setKey: SetKey; data: Inventory; version: number }
  | { type: 'pushed'; setKey: SetKey; version: number }
  | { type: 'signout' }
  | { type: 'status'; status: SyncStatus }
  | { type: 'error'; setKey: SetKey; consecutive: number; message: string }

export type SyncListener = (event: SyncEvent) => void

export type SyncState = {
  versions: Record<SetKey, number>
  pending: Record<SetKey, Inventory>
  lastPulledAt: number
  migrationChoiceMade: boolean
}

const STATE_KEY = 'sync:state'
const RETRY_MS = [1000, 2000, 5000, 15000, 60000] as const
const DEBOUNCE_MS = 1000

const emptyState: SyncState = {
  versions: {},
  pending: {},
  lastPulledAt: 0,
  migrationChoiceMade: false,
}

function readState(storage: Pick<Storage, 'getItem'>): SyncState {
  try {
    const raw = storage.getItem(STATE_KEY)
    if (!raw) return { ...emptyState }
    const parsed = JSON.parse(raw) as Partial<SyncState>
    return {
      versions: parsed.versions ?? {},
      pending: parsed.pending ?? {},
      lastPulledAt: parsed.lastPulledAt ?? 0,
      migrationChoiceMade: parsed.migrationChoiceMade ?? false,
    }
  } catch {
    return { ...emptyState }
  }
}

function writeState(storage: Pick<Storage, 'setItem'>, state: SyncState): void {
  try {
    storage.setItem(STATE_KEY, JSON.stringify(state))
  } catch {
    // If storage is full or blocked, we lose the sync intent — nothing to do.
  }
}

export type CloudSyncDeps = {
  storage: Storage
  fetch: typeof fetch
  now?: () => number
  setTimeoutFn?: (fn: () => void, ms: number) => number
  clearTimeoutFn?: (id: number) => void
  broadcast?: {
    postMessage: (event: BroadcastPayload) => void
    onMessage: (handler: (event: BroadcastPayload) => void) => () => void
  } | null
  onLocalApply?: (setKey: SetKey, data: Inventory) => void
}

export type BroadcastPayload =
  | { type: 'pushed'; setKey: SetKey; data: Inventory; version: number }
  | { type: 'pulled'; setKey: SetKey; data: Inventory; version: number }

type PendingTimer = { id: number; data: Inventory }

export type CloudSync = ReturnType<typeof createCloudSync>

export function createCloudSync(deps: CloudSyncDeps) {
  const now = deps.now ?? (() => Date.now())
  const schedule = deps.setTimeoutFn ?? ((fn: () => void, ms: number) =>
    (setTimeout(fn, ms) as unknown) as number)
  const cancel = deps.clearTimeoutFn ?? ((id: number) => clearTimeout(id))

  const listeners = new Set<SyncListener>()
  const debounces = new Map<SetKey, PendingTimer>()
  const retryTimers = new Map<SetKey, number>()
  const retryAttempt = new Map<SetKey, number>()
  const inFlight = new Set<SetKey>()

  let signedIn = false
  let currentStatus: SyncStatus = 'off'

  const bcUnsub = deps.broadcast?.onMessage(handleBroadcast)

  function emit(event: SyncEvent) {
    for (const listener of listeners) listener(event)
  }

  function setStatus(next: SyncStatus) {
    if (next === currentStatus) return
    currentStatus = next
    emit({ type: 'status', status: next })
  }

  function subscribe(listener: SyncListener): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  }

  function getState(): SyncState {
    return readState(deps.storage)
  }

  function mutate(patch: (s: SyncState) => SyncState): SyncState {
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

  function markMigrationDone(): void {
    mutate(s => ({ ...s, migrationChoiceMade: true }))
  }

  function scheduleSync(setKey: SetKey, data: Inventory): void {
    const snapshot = { ...data }
    mutate(s => ({
      ...s,
      pending: { ...s.pending, [setKey]: snapshot },
    }))
    const existing = debounces.get(setKey)
    if (existing) cancel(existing.id)
    if (!signedIn) return
    const id = schedule(() => {
      debounces.delete(setKey)
      void pushSet(setKey).catch(() => {})
    }, DEBOUNCE_MS)
    debounces.set(setKey, { id, data: snapshot })
  }

  async function pushSet(setKey: SetKey): Promise<void> {
    if (!signedIn) return
    if (inFlight.has(setKey)) return
    const state = readState(deps.storage)
    const data = state.pending[setKey]
    if (!data) return
    inFlight.add(setKey)
    setStatus('pushing')
    const version = state.versions[setKey] ?? 0
    try {
      const res = await deps.fetch(`/api/inventories/${encodeURIComponent(setKey)}`, {
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
        const current = body?.current as { data?: Inventory; version?: number } | undefined
        if (current && typeof current.version === 'number') {
          applyServerVersion(setKey, current.data ?? {}, current.version)
        }
        retryAttempt.delete(setKey)
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
      mutate(s => {
        const nextPending = { ...s.pending }
        delete nextPending[setKey]
        return {
          ...s,
          pending: nextPending,
          versions: { ...s.versions, [setKey]: body.version },
        }
      })
      retryAttempt.delete(setKey)
      setStatus('idle')
      emit({ type: 'pushed', setKey, version: body.version })
      deps.broadcast?.postMessage({ type: 'pushed', setKey, data, version: body.version })
    } catch (err) {
      const attempt = (retryAttempt.get(setKey) ?? 0) + 1
      retryAttempt.set(setKey, attempt)
      const delay = RETRY_MS[Math.min(attempt - 1, RETRY_MS.length - 1)] ?? RETRY_MS[RETRY_MS.length - 1]!
      const existing = retryTimers.get(setKey)
      if (existing) cancel(existing)
      const id = schedule(() => {
        retryTimers.delete(setKey)
        void pushSet(setKey).catch(() => {})
      }, delay)
      retryTimers.set(setKey, id)
      setStatus('error')
      if (attempt >= 3) {
        emit({
          type: 'error',
          setKey,
          consecutive: attempt,
          message: err instanceof Error ? err.message : 'sync_error',
        })
      }
    } finally {
      inFlight.delete(setKey)
    }
  }

  function applyServerVersion(setKey: SetKey, data: Inventory, version: number): void {
    mutate(s => {
      const nextPending = { ...s.pending }
      delete nextPending[setKey]
      return {
        ...s,
        pending: nextPending,
        versions: { ...s.versions, [setKey]: version },
      }
    })
    deps.onLocalApply?.(setKey, data)
    emit({ type: 'pulled', setKey, data, version })
    deps.broadcast?.postMessage({ type: 'pulled', setKey, data, version })
  }

  async function pullAll(): Promise<Record<SetKey, { data: Inventory; version: number }>> {
    if (!signedIn) return {}
    const res = await deps.fetch('/api/inventories', {
      method: 'GET',
      credentials: 'include',
    })
    if (res.status === 401) {
      signedIn = false
      setStatus('off')
      emit({ type: 'signout' })
      return {}
    }
    if (!res.ok) return {}
    const body = (await res.json()) as {
      sets: Record<SetKey, { data: Inventory; version: number; updatedAt: number }>
    }
    const sets = body.sets ?? {}
    mutate(s => {
      const nextVersions = { ...s.versions }
      for (const [k, v] of Object.entries(sets)) nextVersions[k] = v.version
      return { ...s, versions: nextVersions, lastPulledAt: now() }
    })
    return Object.fromEntries(
      Object.entries(sets).map(([k, v]) => [k, { data: v.data, version: v.version }]),
    )
  }

  async function pushAll(sets: Record<SetKey, Inventory>): Promise<void> {
    if (!signedIn) return
    const res = await deps.fetch('/api/inventories', {
      method: 'PUT',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sets }),
    })
    if (res.status === 401) {
      signedIn = false
      setStatus('off')
      emit({ type: 'signout' })
      return
    }
    if (!res.ok) throw new Error(`bulk_failed_${res.status}`)
    const body = (await res.json()) as {
      sets: Record<SetKey, { data: Inventory; version: number }>
    }
    mutate(s => {
      const nextVersions = { ...s.versions }
      const nextPending = { ...s.pending }
      for (const [k, v] of Object.entries(body.sets)) {
        nextVersions[k] = v.version
        delete nextPending[k]
      }
      return { ...s, versions: nextVersions, pending: nextPending, lastPulledAt: now() }
    })
    setStatus('idle')
  }

  async function flushDirty(): Promise<void> {
    if (!signedIn) return
    const pendingKeys = Object.keys(readState(deps.storage).pending)
    await Promise.all(pendingKeys.map(k => pushSet(k).catch(() => {})))
  }

  function handleBroadcast(payload: BroadcastPayload): void {
    if (payload.type !== 'pushed' && payload.type !== 'pulled') return
    mutate(s => {
      const nextPending = { ...s.pending }
      delete nextPending[payload.setKey]
      return {
        ...s,
        pending: nextPending,
        versions: { ...s.versions, [payload.setKey]: payload.version },
      }
    })
    deps.onLocalApply?.(payload.setKey, payload.data)
    emit({
      type: 'pulled',
      setKey: payload.setKey,
      data: payload.data,
      version: payload.version,
    })
  }

  function dispose(): void {
    for (const t of debounces.values()) cancel(t.id)
    for (const id of retryTimers.values()) cancel(id)
    debounces.clear()
    retryTimers.clear()
    listeners.clear()
    bcUnsub?.()
  }

  function status(): SyncStatus {
    return currentStatus
  }

  return {
    subscribe,
    scheduleSync,
    pullAll,
    pushAll,
    flushDirty,
    setSignedIn,
    markMigrationDone,
    getState,
    status,
    dispose,
  }
}

export function makeBrowserBroadcast(): CloudSyncDeps['broadcast'] {
  if (typeof BroadcastChannel === 'undefined') return null
  const channel = new BroadcastChannel('swu-sync')
  return {
    postMessage: event => channel.postMessage(event),
    onMessage: handler => {
      const listener = (ev: MessageEvent<BroadcastPayload>) => handler(ev.data)
      channel.addEventListener('message', listener)
      return () => channel.removeEventListener('message', listener)
    },
  }
}
