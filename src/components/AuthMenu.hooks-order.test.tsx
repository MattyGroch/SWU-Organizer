import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { AuthMenu } from './AuthMenu'

describe('AuthMenu hook order', () => {
  it('does not crash when authStatus transitions from loading to signedIn', () => {
    const { rerender } = render(
      <AuthMenu
        authStatus="loading"
        email={null}
        syncStatus="idle"
        lastSyncedAt={null}
        onSignOut={vi.fn()}
        onSyncNow={vi.fn()}
      />,
    )

    expect(() =>
      rerender(
        <AuthMenu
          authStatus="signedIn"
          email="test@example.com"
          syncStatus="idle"
          lastSyncedAt={null}
          onSignOut={vi.fn()}
          onSyncNow={vi.fn()}
        />,
      ),
    ).not.toThrow()
  })
})
