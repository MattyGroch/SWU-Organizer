import { useCallback, useEffect, useState } from 'react'
import { fetchMe, signOut as signOutRequest } from '../core/auth'

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut'

export type AuthState = {
  status: AuthStatus
  email: string | null
  refresh: () => Promise<void>
  signOut: () => Promise<void>
}

export function useAuth(): AuthState {
  const [status, setStatus] = useState<AuthStatus>('loading')
  const [email, setEmail] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    const me = await fetchMe()
    if (me) {
      setEmail(me.email)
      setStatus('signedIn')
    } else {
      setEmail(null)
      setStatus('signedOut')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const onSignout = () => {
      setEmail(null)
      setStatus('signedOut')
    }
    window.addEventListener('swu:auth-signout', onSignout)
    return () => window.removeEventListener('swu:auth-signout', onSignout)
  }, [refresh])

  const signOut = useCallback(async () => {
    await signOutRequest()
    setEmail(null)
    setStatus('signedOut')
  }, [])

  return { status, email, refresh, signOut }
}
