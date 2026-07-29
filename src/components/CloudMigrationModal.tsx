import React from 'react'
import type { Inventory, SetKey } from '../core/types'

export type CloudSummary = { setKey: SetKey; entries: number }

export type MigrationChoice = 'upload' | 'startFresh' | 'useCloud' | 'merge'

type Props = {
  localSummary: CloudSummary[]
  cloudSummary: CloudSummary[]
  onDecision: (choice: MigrationChoice) => void | Promise<void>
  onDismiss: () => void
}

function totalEntries(summary: CloudSummary[]): number {
  return summary.reduce((a, s) => a + s.entries, 0)
}

export function summarize(sets: Record<SetKey, Inventory>): CloudSummary[] {
  return Object.entries(sets)
    .map(([setKey, inv]) => ({ setKey, entries: Object.keys(inv ?? {}).length }))
    .filter(s => s.entries > 0)
    .sort((a, b) => a.setKey.localeCompare(b.setKey))
}

export function CloudMigrationModal({
  localSummary,
  cloudSummary,
  onDecision,
  onDismiss,
}: Props) {
  const localCount = totalEntries(localSummary)
  const cloudCount = totalEntries(cloudSummary)
  const [busy, setBusy] = React.useState(false)

  async function pick(choice: MigrationChoice) {
    setBusy(true)
    try {
      await onDecision(choice)
    } finally {
      setBusy(false)
    }
  }

  let body: React.ReactNode
  let actions: React.ReactNode

  if (localCount === 0 && cloudCount === 0) {
    // Should be auto-dismissed by the caller before rendering.
    body = <p>No inventory data found locally or in the cloud.</p>
    actions = (
      <button type="button" className="tbtn" onClick={onDismiss}>
        <span>Got it</span>
      </button>
    )
  } else if (cloudCount === 0 && localCount > 0) {
    body = (
      <>
        <p>
          You have <strong>{localCount}</strong> local inventory entries and the cloud
          copy is empty.
        </p>
        <p>Do you want to upload your local inventory to the cloud?</p>
      </>
    )
    actions = (
      <>
        <button
          type="button"
          className="tbtn"
          disabled={busy}
          onClick={() => void pick('upload')}
        >
          <span className="icon" aria-hidden="true">cloud_upload</span>
          <span>Upload local to cloud</span>
        </button>
        <button
          type="button"
          className="tbtn tbtn-danger"
          disabled={busy}
          onClick={() => void pick('startFresh')}
        >
          <span className="icon" aria-hidden="true">delete</span>
          <span>Start fresh (discard local)</span>
        </button>
      </>
    )
  } else if (localCount === 0 && cloudCount > 0) {
    body = (
      <p>
        Restoring <strong>{cloudCount}</strong> inventory entries from the cloud.
      </p>
    )
    actions = (
      <button
        type="button"
        className="tbtn"
        disabled={busy}
        onClick={() => void pick('useCloud')}
      >
        <span className="icon" aria-hidden="true">cloud_download</span>
        <span>Use cloud copy</span>
      </button>
    )
  } else {
    body = (
      <>
        <p>
          Cloud has <strong>{cloudCount}</strong> inventory entries and this device has{' '}
          <strong>{localCount}</strong>. Choose how to reconcile.
        </p>
        <ul style={{ margin: '8px 0 0 16px', padding: 0 }}>
          <li><strong>Use cloud:</strong> discard local changes and mirror the cloud copy.</li>
          <li><strong>Merge:</strong> combine both (higher quantity per card wins).</li>
        </ul>
      </>
    )
    actions = (
      <>
        <button
          type="button"
          className="tbtn"
          disabled={busy}
          onClick={() => void pick('useCloud')}
        >
          <span className="icon" aria-hidden="true">cloud_download</span>
          <span>Use cloud (discard local)</span>
        </button>
        <button
          type="button"
          className="tbtn"
          disabled={busy}
          onClick={() => void pick('merge')}
        >
          <span className="icon" aria-hidden="true">merge</span>
          <span>Merge local into cloud</span>
        </button>
      </>
    )
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Cloud sync setup"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <div
        className="card"
        style={{ maxWidth: 520, width: '90%', padding: 20, background: '#141821' }}
      >
        <h2 style={{ marginTop: 0 }}>Set up cloud sync</h2>
        <div style={{ fontSize: 14, lineHeight: 1.4 }}>{body}</div>
        <div
          className="toolbar-group"
          style={{ marginTop: 16, gap: 8, flexWrap: 'wrap' }}
        >
          {actions}
        </div>
      </div>
    </div>
  )
}
