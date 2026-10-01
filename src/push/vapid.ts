import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';

export interface VapidDetails {
  subject: string;
  publicKey: string;
  privateKey: string;
}

let cached: VapidDetails | null | undefined;

// The public key and contact come from the environment; the private key is read once from
// Parameter Store (SecureString) and kept in memory, never logged. Null means "not set up yet".
export async function loadVapid(env: NodeJS.ProcessEnv = process.env): Promise<VapidDetails | null> {
  if (cached !== undefined) return cached;

  const publicKey = env.VAPID_PUBLIC_KEY ?? '';
  const subject = env.VAPID_SUBJECT ?? '';
  const parameter = env.VAPID_PRIVATE_KEY_PARAMETER ?? '';
  if (!publicKey || !subject || !parameter) {
    cached = null;
    return cached;
  }

  try {
    const client = new SSMClient({ region: env.AWS_REGION || 'eu-west-2' });
    const result = await client.send(new GetParameterCommand({ Name: parameter, WithDecryption: true }));
    const privateKey = result.Parameter?.Value ?? '';
    cached = privateKey ? { subject, publicKey, privateKey } : null;
  } catch (error) {
    // Only the error's name: its message can echo the parameter name or request details.
    console.error('Push reminders: could not read the VAPID private key', error instanceof Error ? error.name : 'UnknownError');
    cached = null;
  }
  return cached;
}

export function resetVapidCache(): void {
  cached = undefined;
}
