import React from 'react'
import type { SyncStatus } from '../core/cloudSync'
import { beginSignIn } from '../core/auth'

type Props = {
  authStatus: 'loading' | 'signedIn' | 'signedOut'
  email: string | null
  syncStatus: SyncStatus
  onSignOut: () => void | Promise<void>
}

function statusLabel(status: SyncStatus): string {
  switch (status) {
    case 'off':
      return 'Cloud sync off'
    case 'idle':
      return 'Cloud sync on'
    case 'pushing':
      return 'Syncing…'
    case 'error':
      return 'Sync retrying'
    case 'offline':
      return 'Offline — queued'
  }
}

export function AuthMenu({ authStatus, email, syncStatus, onSignOut }: Props) {
  const [menuOpen, setMenuOpen] = React.useState(false)

  if (authStatus === 'loading') {
    return (
      <div className="toolbar-block">
        <div className="toolbar-label">Cloud</div>
        <div className="toolbar-group">
          <span className="muted" style={{ fontSize: 12 }}>
            Checking sign-in…
          </span>
        </div>
      </div>
    )
  }

  return (
    <div className="toolbar-block">
      <div className="toolbar-label">Cloud</div>
      <div className="toolbar-group" style={{ position: 'relative' }}>
        {authStatus === 'signedOut' ? (
          <button
            type="button"
            className="tbtn"
            onClick={() => beginSignIn()}
            title="Sign in with Google to enable cloud sync"
            aria-label="Sign in with Google"
          >
            <span className="icon" aria-hidden="true">login</span>
            <span>Sign in with Google</span>
          </button>
        ) : (
          <>
            <button
              type="button"
              className="tbtn"
              onClick={() => setMenuOpen(v => !v)}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title={email ?? undefined}
              style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis' }}
            >
              <span className="icon" aria-hidden="true">account_circle</span>
              <span
                style={{
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: 160,
                }}
              >
                {email ?? 'Signed in'}
              </span>
              <span aria-hidden="true">▾</span>
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
                  minWidth: 180,
                }}
              >
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
          </>
        )}
        <span
          aria-label={statusLabel(syncStatus)}
          title={statusLabel(syncStatus)}
          style={{
            fontSize: 11,
            padding: '2px 8px',
            borderRadius: 999,
            border: '1px solid currentColor',
            opacity: 0.75,
            color:
              syncStatus === 'error'
                ? '#f87171'
                : syncStatus === 'off'
                  ? '#9aa0b4'
                  : syncStatus === 'pushing'
                    ? '#facc15'
                    : '#22c55e',
            whiteSpace: 'nowrap',
          }}
        >
          {statusLabel(syncStatus)}
        </span>
      </div>
    </div>
  )
}
