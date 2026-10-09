// Every route renders its own layout, and so its own provider. The session lives here, outside React,
// so navigating does not re-check it and flash a loading state.
export interface LocalUser {
  sub: string;
  email: string;
}

export type LocalAuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; setupRequired: boolean }
  | { status: 'signedIn'; user: LocalUser };

let state: LocalAuthState = { status: 'loading' };
let started: Promise<void> | undefined;
const listeners = new Set<() => void>();

function set(next: LocalAuthState): void {
  state = next;
  listeners.forEach(listener => listener());
}

export function getLocalAuthState(): LocalAuthState {
  return state;
}

export function subscribeLocalAuth(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

async function readError(response: Response, fallback: string): Promise<Error> {
  try {
    const body = (await response.json()) as { error?: unknown };
    return new Error(typeof body.error === 'string' ? body.error : fallback);
  } catch {
    return new Error(fallback);
  }
}

export async function refreshLocalAuth(): Promise<void> {
  try {
    const me = await fetch('/api/auth/me');
    if (me.ok) {
      const body = (await me.json()) as { userId: string; email: string };
      set({ status: 'signedIn', user: { sub: body.userId, email: body.email } });
      return;
    }
    const status = await fetch('/api/auth/status');
    const body = (await status.json()) as { setupRequired?: unknown };
    set({ status: 'signedOut', setupRequired: body.setupRequired === true });
  } catch (error) {
    console.error('Could not check the local session:', error);
    set({ status: 'signedOut', setupRequired: false });
  }
}

export function ensureLocalAuth(): Promise<void> {
  started ??= refreshLocalAuth();
  return started;
}

async function signIn(path: string, body: unknown, fallback: string): Promise<void> {
  const response = await postJson(path, body);
  if (!response.ok) throw await readError(response, fallback);
  const user = (await response.json()) as { userId: string; email: string };
  set({ status: 'signedIn', user: { sub: user.userId, email: user.email } });
}

export function loginLocal(email: string, password: string): Promise<void> {
  return signIn('/api/auth/login', { email, password }, 'Sign in failed');
}

export function setupLocal(input: { code: string; email: string; password: string }): Promise<void> {
  return signIn('/api/auth/setup', input, 'Setup failed');
}

export async function logoutLocal(): Promise<void> {
  await postJson('/api/auth/logout', {});
}

// The API said 401: the session ended on the server (expired, or reset from the CLI).
export function expireLocalSession(): void {
  set({ status: 'signedOut', setupRequired: false });
}

export function resetLocalAuthForTests(): void {
  state = { status: 'loading' };
  started = undefined;
  listeners.clear();
}
