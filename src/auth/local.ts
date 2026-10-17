import { err } from '../api/http';
import { initStore } from '../store';
import { originAllowed, readSessionCookie } from './cookies';
import { clearThrottle, deleteAllSessions, getAccount, readSession } from './localData';
import { handleAuthRoute } from './routes';
import type { AuthRouteContext } from './routes';
import { SetupCode } from './setupCode';
import type { AuthProvider } from './types';

const nowSeconds = (): number => Math.floor(Date.now() / 1000);

// The container shows the code through these hooks (a boxed log block plus a file). Without hooks the code is one log line.
export interface CodeHooks {
  announce(code: string, kind: 'setup' | 'recovery'): void;
  // The code was used or is dead: remove any copy of it.
  retire(): void;
}

export interface LocalProviderOptions {
  hooks?: CodeHooks;
  // The operator asked to reset the password. Ignored while no account exists (setup is then already open).
  recovery?: boolean;
}

function logCode(code: string, kind: 'setup' | 'recovery'): void {
  // The one place a secret is logged, and only so the person who deployed the instance can read it.
  if (kind === 'setup') {
    console.log(`First-run setup: open the app and enter this setup code to create your account: ${code}`);
    return;
  }
  console.log(`Password recovery: open the app and enter this recovery code to set a new password: ${code}`);
}

export async function createLocalProvider(env: NodeJS.ProcessEnv, options: LocalProviderOptions = {}): Promise<AuthProvider> {
  const store = await initStore(env);
  const { hooks } = options;

  const hasAccount = (await getAccount(store)) !== undefined;
  const recovery = hasAccount && options.recovery === true;
  if (recovery) {
    // Opening recovery signs everyone out and lifts any lock-out, as `store-cli reset-password` does.
    await deleteAllSessions(store);
    await clearThrottle(store);
  }

  const setupCode = !hasAccount || recovery ? SetupCode.generate() : undefined;
  if (setupCode) {
    const kind = recovery ? 'recovery' : 'setup';
    if (hooks) hooks.announce(setupCode.reveal(), kind);
    else logCode(setupCode.reveal(), kind);
  }

  const secureCookie = env.COOKIE_SECURE !== 'false';
  const appOrigin = env.APP_ORIGIN || undefined;
  const ctx: AuthRouteContext = {
    store, setupCode, recovery, onCodeUsed: hooks ? () => hooks.retire() : undefined, secureCookie, appOrigin, nowSeconds,
  };

  return {
    handlePublic: event => handleAuthRoute(event, ctx),

    async authenticate(event) {
      if (!originAllowed(event, appOrigin)) return { rejection: err(403, 'Forbidden') };
      const session = await readSession(store, readSessionCookie(event, secureCookie), nowSeconds());
      if (!session) return { rejection: err(401, 'Unauthorized') };
      return { userId: session.userId };
    },
  };
}
