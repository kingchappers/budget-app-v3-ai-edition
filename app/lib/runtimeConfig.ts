export type RuntimeConfig =
  | { auth: 'local' }
  | { auth: 'auth0'; domain: string; clientId: string; audience: string };

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

export function parseRuntimeConfig(value: unknown): RuntimeConfig {
  if (typeof value !== 'object' || value === null) throw new Error('config.json must be a JSON object');
  const record = value as Record<string, unknown>;

  if (record.auth === 'local') return { auth: 'local' };
  if (record.auth === 'auth0') {
    const { domain, clientId, audience } = record;
    if (nonEmptyString(domain) && nonEmptyString(clientId) && nonEmptyString(audience)) {
      return { auth: 'auth0', domain, clientId, audience };
    }
    throw new Error('config.json: auth0 mode needs a domain, clientId and audience');
  }
  throw new Error('config.json: "auth" must be "auth0" or "local"');
}

export async function loadRuntimeConfig(fetchImpl: typeof fetch = fetch): Promise<RuntimeConfig> {
  const response = await fetchImpl('/config.json', { cache: 'no-cache' });
  if (!response.ok) throw new Error(`config.json could not be loaded (${response.status})`);
  return parseRuntimeConfig(await response.json());
}

// `yarn dev` has no build step to write config.json, so it may fall back to the Vite variables. A production build never does.
export function configFromViteEnv(env: Record<string, unknown>): RuntimeConfig | undefined {
  const { VITE_AUTH0_DOMAIN: domain, VITE_AUTH0_CLIENT_ID: clientId, VITE_AUTH0_AUDIENCE: audience } = env;
  if (nonEmptyString(domain) && nonEmptyString(clientId) && nonEmptyString(audience)) {
    return { auth: 'auth0', domain, clientId, audience };
  }
  return undefined;
}

let loading: Promise<RuntimeConfig> | undefined;

// Every route renders its own layout, so the config is fetched once and shared.
export function getRuntimeConfig(): Promise<RuntimeConfig> {
  loading ??= loadRuntimeConfig().catch((error: unknown) => {
    const fallback = import.meta.env.DEV ? configFromViteEnv(import.meta.env) : undefined;
    if (fallback) return fallback;
    loading = undefined; // let a retry fetch again
    throw error;
  });
  return loading;
}
