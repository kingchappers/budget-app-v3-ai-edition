import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { isRecord } from '../api/body';
import type { TlCredentials, TlEnvironment } from './providers/trueLayerClient';

const ENVIRONMENTS = new Set<TlEnvironment>(['live', 'sandbox']);

let cached: Promise<TlCredentials> | undefined;

export function parseTlCredentials(secretString: string | undefined): TlCredentials {
  if (!secretString) {
    throw new Error('TrueLayer secret is empty; set it with aws secretsmanager put-secret-value');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(secretString);
  } catch {
    throw new Error('TrueLayer secret is not valid JSON');
  }
  if (
    !isRecord(parsed)
    || typeof parsed.clientId !== 'string' || !parsed.clientId
    || typeof parsed.clientSecret !== 'string' || !parsed.clientSecret
    || typeof parsed.environment !== 'string' || !ENVIRONMENTS.has(parsed.environment as TlEnvironment)
  ) {
    throw new Error('TrueLayer secret must contain clientId, clientSecret and environment ("live" or "sandbox")');
  }
  return { clientId: parsed.clientId, clientSecret: parsed.clientSecret, environment: parsed.environment as TlEnvironment };
}

export function loadTlCredentials(secretId: string, client: SecretsManagerClient = new SecretsManagerClient({})): Promise<TlCredentials> {
  cached ??= client
    .send(new GetSecretValueCommand({ SecretId: secretId }))
    .then(result => parseTlCredentials(result.SecretString))
    .catch((error: unknown) => {
      cached = undefined;
      throw error;
    });
  return cached;
}
