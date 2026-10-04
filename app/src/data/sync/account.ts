/**
 * The signed-in account, as the server sees it.
 *
 * Sign-in itself is a full-page trip: `/api/auth/login` sends the browser to Google,
 * Google returns to `/api/auth/callback`, and the server sets a session cookie and
 * redirects back to the app. The app only ever asks "who am I?" and "sign me out".
 */

export const SIGN_IN_URL = '/api/auth/login';

export type Account = { email: string };

/** Signed in, signed out, or the sync server could not be reached at all. */
export type AccountState = Account | 'signedOut' | 'unavailable';

export async function fetchAccount(fetchFn: typeof fetch = fetch): Promise<AccountState> {
  try {
    const response = await fetchFn('/api/auth/me', { credentials: 'include' });
    if (response.status === 401) return 'signedOut';
    if (!response.ok) return 'unavailable';
    const body = (await response.json()) as Partial<Account>;
    return typeof body.email === 'string' ? { email: body.email } : 'unavailable';
  } catch {
    return 'unavailable';
  }
}

export async function signOut(fetchFn: typeof fetch = fetch): Promise<void> {
  await fetchFn('/api/auth/logout', { method: 'POST', credentials: 'include' }).catch(() => {});
}
