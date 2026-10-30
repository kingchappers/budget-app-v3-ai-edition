import type { AuthProvider } from './types';

export * from './types';

let current: AuthProvider | undefined;
let pending: Promise<AuthProvider> | undefined;

export function getAuth(): AuthProvider {
  if (!current) {
    throw new Error('Auth not initialised: call initAuth() at startup');
  }
  return current;
}

export function setAuth(provider: AuthProvider | undefined): void {
  current = provider;
  pending = undefined;
}

async function createAuth(env: NodeJS.ProcessEnv): Promise<AuthProvider> {
  const mode = env.AUTH_MODE || 'auth0';
  if (mode === 'auth0') {
    const { createAuth0Provider } = await import('./auth0');
    return createAuth0Provider(env);
  }
  if (mode === 'local') {
    const { createLocalProvider } = await import('./local');
    return createLocalProvider(env);
  }
  throw new Error(`Unknown AUTH_MODE "${mode}": expected "auth0" or "local"`);
}

// Creates only the chosen provider. The Lambda still bundles local-login modules (the token routes import them), but it
// never creates the local-login provider, so its start-up work (setup code, recovery) never runs there.
export function initAuth(env: NodeJS.ProcessEnv = process.env): Promise<AuthProvider> {
  if (current) return Promise.resolve(current);
  pending ??= createAuth(env).then(
    provider => {
      current = provider;
      return provider;
    },
    error => {
      pending = undefined;
      throw error;
    },
  );
  return pending;
}
