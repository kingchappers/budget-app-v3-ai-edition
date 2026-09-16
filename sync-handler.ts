import type { Context } from 'aws-lambda';
import { executeWorkerCommand, isScheduledEvent, parseWorkerCommand } from './src/sync/commands';
import type { WorkerDeps } from './src/sync/commands';
import { jsonLogger } from './src/sync/log';
import { createTrueLayerProvider } from './src/sync/providers/trueLayer';
import type { TrueLayerApi } from './src/sync/providers/trueLayer';
import { createTlClient, createTlTokenSource, TL_API_BASE } from './src/sync/providers/trueLayerClient';
import { runSync } from './src/sync/runSync';
import { loadTlCredentials } from './src/sync/secrets';
import { createDynamoSyncStore } from './src/sync/stores/dynamoSyncStore';

const DEADLINE_MARGIN_MS = 15_000;
const store = createDynamoSyncStore();
let trueLayer: TrueLayerApi | undefined;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

async function getTrueLayer(): Promise<TrueLayerApi> {
  if (trueLayer) return trueLayer;
  const credentials = await loadTlCredentials(requireEnv('TL_SECRET_ID'));
  const client = createTlClient({
    apiBase: TL_API_BASE[credentials.environment],
    token: createTlTokenSource(credentials, Date.now),
  });
  trueLayer = createTrueLayerProvider(client, { environment: credentials.environment });
  return trueLayer;
}

export const handler = async (event: unknown, context: Context): Promise<unknown> => {
  const tl = await getTrueLayer();
  const deps: WorkerDeps = {
    store,
    providers: { truelayer: tl },
    tl,
    now: () => Date.now(),
    deadline: Date.now() + context.getRemainingTimeInMillis() - DEADLINE_MARGIN_MS,
    log: jsonLogger,
    redirectUrl: `${requireEnv('APP_BASE_URL')}/banks/callback`,
    newId: () => crypto.randomUUID(),
  };

  if (isScheduledEvent(event)) {
    const userIds = await store.listSyncUserIds();
    await runSync(deps, userIds);
    jsonLogger('sync.scheduled_done', { users: userIds.length });
    return { ok: true };
  }

  const command = parseWorkerCommand(event);
  if (!command) {
    jsonLogger('worker.bad_command', {});
    return { ok: false, error: 'BAD_REQUEST', message: 'Invalid command' };
  }
  return executeWorkerCommand(deps, command);
};
