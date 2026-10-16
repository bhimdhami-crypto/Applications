// The API client. The access token lives only in memory; the refresh token is an http-only
// cookie the browser sends to /api/auth, so page scripts can never read it.

let accessToken: string | null = null;
let refreshing: Promise<boolean> | null = null;

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function messageOf(res: Response) {
  try {
    const body = await res.json();
    const m = body?.message;
    return Array.isArray(m) ? m.join('. ') : typeof m === 'string' ? m : res.statusText;
  } catch {
    return res.status === 502 || res.status === 504 ? 'The portal server is not running. Start it with npm run dev:api.' : res.statusText;
  }
}

/** Swaps the refresh cookie for a new access token. Concurrent callers share one attempt. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= fetch('/api/auth/refresh', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' })
    .then(async (res) => {
      if (!res.ok) {
        accessToken = null;
        return false;
      }
      accessToken = (await res.json()).accessToken;
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const send = () =>
    fetch(`/api${path}`, {
      method: init.method ?? 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
  if (!accessToken) await refreshSession();
  let res = await send();
  if (res.status === 401 && (await refreshSession())) res = await send();
  if (!res.ok) throw new ApiError(await messageOf(res), res.status);
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function login(email: string, password: string) {
  const res = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  if (!res.ok) throw new ApiError(await messageOf(res), res.status);
  return res.json() as Promise<{ challengeId: string; sentTo: string; expiresInSeconds: number }>;
}

export async function verify(challengeId: string, code: string) {
  const res = await fetch('/api/auth/verify', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ challengeId, code, client: 'web' }) });
  if (!res.ok) throw new ApiError(await messageOf(res), res.status);
  accessToken = (await res.json()).accessToken;
}

export async function logout() {
  await fetch('/api/auth/logout', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => undefined);
  accessToken = null;
}
