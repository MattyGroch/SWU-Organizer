export type AuthMe = { email: string }

export async function fetchMe(fetchFn: typeof fetch = fetch): Promise<AuthMe | null> {
  try {
    const res = await fetchFn('/api/auth/me', { credentials: 'include' })
    if (!res.ok) return null
    return (await res.json()) as AuthMe
  } catch {
    return null
  }
}

export function beginSignIn(): void {
  window.location.assign('/api/auth/login')
}

export async function signOut(fetchFn: typeof fetch = fetch): Promise<void> {
  try {
    await fetchFn('/api/auth/logout', { method: 'POST', credentials: 'include' })
  } catch {
    // best-effort; the cookie is cleared server-side.
  }
}
