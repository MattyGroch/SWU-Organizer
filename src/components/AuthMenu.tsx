import React from 'react'
import type { SyncStatus } from '../core/cloudSync'
import { beginSignIn } from '../core/auth'
import { useClickOutside } from '../hooks/useClickOutside'

type Props = {
  authStatus: 'loading' | 'signedIn' | 'signedOut'
  email: string | null
  syncStatus: SyncStatus
  lastSyncedAt: number | null
  onSignOut: () => void | Promise<void>
  onSyncNow: () => void | Promise<void>
}

type StatusMeta = { icon: string; color: string; label: string; spin?: boolean }

function statusMeta(status: SyncStatus): StatusMeta {
  switch (status) {
    case 'off':
      return { icon: 'cloud_off', color: '#9aa0b4', label: 'Cloud sync off' }
    case 'idle':
      return { icon: 'cloud_done', color: '#22c55e', label: 'Cloud sync on' }
    case 'pushing':
      return { icon: 'sync', color: '#facc15', label: 'Syncing…', spin: true }
    case 'error':
      return { icon: 'sync_problem', color: '#f87171', label: 'Sync retrying' }
    case 'offline':
      return { icon: 'cloud_off', color: '#fb923c', label: 'Offline — queued' }
  }
}

function formatLastSynced(ts: number | null): string {
  if (!ts) return 'Never synced'
  const diffMs = Date.now() - ts
  if (diffMs < 60_000) return 'Just now'
  const minutes = Math.floor(diffMs / 60_000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return new Date(ts).toLocaleDateString()
}

export function AuthMenu({ authStatus, email, syncStatus, lastSyncedAt, onSignOut, onSyncNow }: Props) {
  const [menuOpen, setMenuOpen] = React.useState(false)

  if (authStatus === 'loading') {
    return (
      <div className="toolbar-group">
        <span className="tbtn" style={{ cursor: 'default' }} title="Checking sign-in…" aria-label="Checking sign-in…">
          <span className="icon icon-spin" aria-hidden="true">sync</span>
          <span>Cloud</span>
        </span>
      </div>
    )
  }

  if (authStatus === 'signedOut') {
    return (
      <div className="toolbar-group">
        <button
          type="button"
          className="tbtn"
          onClick={() => beginSignIn()}
          title="Sign in with Google to enable cloud sync"
          aria-label="Sign in with Google"
        >
          <span className="icon" aria-hidden="true">login</span>
          <span>Cloud</span>
        </button>
      </div>
    )
  }

  const meta = statusMeta(syncStatus)
  const containerRef = useClickOutside<HTMLDivElement>(menuOpen, () => setMenuOpen(false))

  return (
    <div ref={containerRef} className="toolbar-group" style={{ position: 'relative', overflow: 'visible' }}>
      <button
        type="button"
        className="tbtn sync-status-trigger"
        onClick={() => setMenuOpen(v => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title={`${email ?? 'Signed in'} — ${meta.label}`}
        aria-label={`Cloud sync: ${meta.label}`}
      >
        <span style={{ position: 'relative', display: 'inline-flex' }}>
          <span className="icon" aria-hidden="true">account_circle</span>
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              right: -2,
              bottom: -2,
              width: 8,
              height: 8,
              borderRadius: '50%',
              background: meta.color,
              border: '1.5px solid #14161f',
            }}
          />
        </span>
        <span>Cloud</span>
      </button>
      {menuOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute',
              top: '100%',
              right: 0,
              marginTop: 4,
              background: '#1a1c25',
              border: '1px solid #333',
              borderRadius: 6,
              padding: 6,
              zIndex: 20,
              minWidth: 220,
            }}
          >
            <div style={{ padding: '6px 8px', color: '#eaeaf0', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {email ?? 'Signed in'}
            </div>
            <div style={{ padding: '0 8px 6px', display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span
                className={`icon icon-sm${meta.spin ? ' icon-spin' : ''}`}
                aria-hidden="true"
                style={{ color: meta.color }}
              >
                {meta.icon}
              </span>
              <span style={{ color: meta.color }}>{meta.label}</span>
            </div>
            <div style={{ padding: '0 8px 6px', color: '#9aa0b4', fontSize: 11 }}>
              Last synced: {formatLastSynced(lastSyncedAt)}
            </div>
            <button
              type="button"
              role="menuitem"
              className="tbtn"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={() => {
                void onSyncNow()
              }}
            >
              <span className="icon" aria-hidden="true">sync</span>
              <span>Sync now</span>
            </button>
            <div style={{ height: 1, background: '#333', margin: '6px 2px' }} />
            <button
              type="button"
              role="menuitem"
              className="tbtn"
              style={{ width: '100%', justifyContent: 'flex-start' }}
              onClick={() => {
                setMenuOpen(false)
                void onSignOut()
              }}
            >
              <span className="icon" aria-hidden="true">logout</span>
              <span>Sign out</span>
            </button>
          </div>
        )}
      </div>
  )
}

