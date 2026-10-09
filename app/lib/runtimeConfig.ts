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

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function loadRuntimeConfig(fetchImpl: typeof fetch = fetch): Promise<RuntimeConfig> {
  let response: Response;
  try {
    response = await fetchImpl('/config.json', { cache: 'no-cache' });
  } catch (error: unknown) {
    throw new Error(`config.json could not be loaded: ${errorMessage(error)}`, { cause: error });
  }
  if (!response.ok) throw new Error(`config.json could not be loaded (${response.status})`);

  let body: unknown;
  try {
    body = await response.json();
  } catch (error: unknown) {
    throw new Error('config.json is not valid JSON', { cause: error });
  }
  return parseRuntimeConfig(body);
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
let resolved: RuntimeConfig | undefined;

// The config once it has loaded, so a layout that mounts later can render without waiting.
export function peekRuntimeConfig(): RuntimeConfig | undefined {
  return resolved;
}

// Every route renders its own layout, so the config is fetched once and shared.
export function getRuntimeConfig(): Promise<RuntimeConfig> {
  loading ??= loadRuntimeConfig()
    .catch((error: unknown) => {
      const fallback = import.meta.env.DEV ? configFromViteEnv(import.meta.env) : undefined;
      if (fallback) return fallback;
      loading = undefined; // let a retry fetch again
      throw error;
    })
    .then(config => {
      resolved = config;
      return config;
    });
  return loading;
}
