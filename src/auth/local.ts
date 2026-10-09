import { err } from '../api/http';
import { initStore } from '../store';
import { originAllowed, readSessionCookie } from './cookies';
import { getAccount, readSession } from './localData';
import { handleAuthRoute } from './routes';
import type { AuthRouteContext } from './routes';
import { SetupCode } from './setupCode';
import type { AuthProvider } from './types';

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

export async function createLocalProvider(env: NodeJS.ProcessEnv): Promise<AuthProvider> {
  const store = await initStore(env);

  // The one place a secret is logged, and only so the person who deployed the instance can read it.
  const setupCode = (await getAccount(store)) ? undefined : SetupCode.generate();
  if (setupCode) {
    console.log(`First-run setup: open the app and enter this setup code to create your account: ${setupCode.reveal()}`);
  }

  const ctx: AuthRouteContext = { store, setupCode, secureCookie: env.COOKIE_SECURE !== 'false', nowSeconds };

  return {
    handlePublic: event => handleAuthRoute(event, ctx),

    async authenticate(event) {
      if (!originAllowed(event)) return { rejection: err(403, 'Forbidden') };
      const session = await readSession(store, readSessionCookie(event), nowSeconds());
      if (!session) return { rejection: err(401, 'Unauthorized') };
      return { userId: session.userId };
    },
  };
}
