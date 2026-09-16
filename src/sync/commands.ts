import { DATE_RE, UUID_RE, hasOnlyKeys, isRecord } from '../api/body';
import { matchAccounts } from './accounts';
import { classifyProviderError } from './errors';
import type { TrueLayerApi } from './providers/trueLayer';
import { runSync } from './runSync';
import type { RunSyncDeps, UserSyncOutcome } from './runSync';
import type { Connection, PsuContext } from './types';

const PENDING_AUTH_TTL_S = 15 * 60;
const MAX_USER_ID_LENGTH = 200;
const MAX_PSU_FIELD_LENGTH = 512;
const UPSTREAM_MESSAGE = 'The bank service could not complete the request';

export type WorkerCommand =
  | { command: 'createConnection'; userId: string; startDate: string; connectionId?: string; psu: PsuContext }
  | { command: 'completeConnection'; userId: string; state: string; psu: PsuContext }
  | { command: 'syncNow'; userId: string; psu: PsuContext }
  | { command: 'disconnect'; userId: string; connectionId: string };

type CommandOf<C extends WorkerCommand['command']> = Extract<WorkerCommand, { command: C }>;

export type WorkerErrorCode = 'BAD_REQUEST' | 'NOT_FOUND' | 'UPSTREAM';
export type WorkerResult<T> = { ok: true; value: T } | { ok: false; error: WorkerErrorCode; message: string };

export type CompleteConnectionResult = { status: 'PENDING' } | { status: 'READY'; connection: Connection };

export interface WorkerDeps extends RunSyncDeps {
  tl: TrueLayerApi;
  redirectUrl: string;
  newId: () => string;
}

const success = <T>(value: T): WorkerResult<T> => ({ ok: true, value });
const failure = (error: WorkerErrorCode, message: string): WorkerResult<never> => ({ ok: false, error, message });

function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function isPsuContext(value: unknown): value is PsuContext {
  return isRecord(value)
    && hasOnlyKeys(value, ['ipAddress', 'userAgent'])
    && isBoundedString(value.ipAddress, MAX_PSU_FIELD_LENGTH)
    && typeof value.userAgent === 'string'
    && value.userAgent.length <= MAX_PSU_FIELD_LENGTH;
}

const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID_RE.test(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && DATE_RE.test(value);
const isUserId = (value: unknown): value is string => isBoundedString(value, MAX_USER_ID_LENGTH);

export function isScheduledEvent(event: unknown): boolean {
  return isRecord(event) && event.source === 'aws.events' && event['detail-type'] === 'Scheduled Event';
}

export function parseWorkerCommand(input: unknown): WorkerCommand | null {
  if (!isRecord(input)) return null;
  const c = input;

  switch (c.command) {
    case 'createConnection': {
      if (!hasOnlyKeys(c, ['command', 'userId', 'startDate', 'psu'], ['connectionId'])) return null;
      if (!isUserId(c.userId) || !isDate(c.startDate) || !isPsuContext(c.psu)) return null;
      if (c.connectionId !== undefined && !isUuid(c.connectionId)) return null;
      const command: CommandOf<'createConnection'> = {
        command: 'createConnection', userId: c.userId, startDate: c.startDate, psu: c.psu,
      };
      if (typeof c.connectionId === 'string') command.connectionId = c.connectionId;
      return command;
    }

    case 'completeConnection':
      if (!hasOnlyKeys(c, ['command', 'userId', 'state', 'psu'])) return null;
      if (!isUserId(c.userId) || !isUuid(c.state) || !isPsuContext(c.psu)) return null;
      return { command: 'completeConnection', userId: c.userId, state: c.state, psu: c.psu };

    case 'syncNow':
      if (!hasOnlyKeys(c, ['command', 'userId', 'psu']) || !isUserId(c.userId) || !isPsuContext(c.psu)) return null;
      return { command: 'syncNow', userId: c.userId, psu: c.psu };

    case 'disconnect':
      if (!hasOnlyKeys(c, ['command', 'userId', 'connectionId']) || !isUserId(c.userId) || !isUuid(c.connectionId)) return null;
      return { command: 'disconnect', userId: c.userId, connectionId: c.connectionId };

    default:
      return null;
  }
}

async function createConnection(deps: WorkerDeps, command: CommandOf<'createConnection'>): Promise<WorkerResult<{ url: string; state: string }>> {
  if (command.connectionId && !(await deps.store.getConnection(command.userId, command.connectionId))) {
    return failure('NOT_FOUND', 'Connection not found');
  }

  const now = deps.now();
  const state = deps.newId();
  const { providerConnectionId, hostedPageUrl } = await deps.tl.createConnection({
    returnUri: deps.redirectUrl,
    state,
    psu: command.psu,
  });

  await deps.store.putPendingAuth(command.userId, {
    state,
    startDate: command.startDate,
    providerConnectionId,
    ...(command.connectionId ? { connectionId: command.connectionId } : {}),
    expiresAt: Math.floor(now / 1000) + PENDING_AUTH_TTL_S,
  });

  return success({ url: hostedPageUrl, state });
}

async function completeConnection(deps: WorkerDeps, command: CommandOf<'completeConnection'>): Promise<WorkerResult<CompleteConnectionResult>> {
  const pending = await deps.store.getPendingAuth(command.userId, command.state, deps.now());
  if (!pending || !pending.providerConnectionId) {
    return failure('NOT_FOUND', 'This bank connection attempt has expired. Please start again.');
  }

  const status = await deps.tl.pollConnectionStatus(pending.providerConnectionId);
  if (status === 'FAILED') {
    await deps.store.deletePendingAuth(command.userId, command.state);
    return failure('UPSTREAM', UPSTREAM_MESSAGE);
  }
  if (status === 'PENDING') {
    return success({ status: 'PENDING' });
  }

  const [userInfo, accounts] = await Promise.all([
    deps.tl.getUserInfo(pending.providerConnectionId),
    deps.tl.getAccounts(pending.providerConnectionId),
  ]);

  const nowIso = new Date(deps.now()).toISOString();
  const auth = { providerConnectionId: pending.providerConnectionId };
  let connection: Connection;

  if (pending.connectionId) {
    const existing = await deps.store.getConnection(command.userId, pending.connectionId);
    if (!existing) return failure('NOT_FOUND', 'Connection not found');
    connection = {
      ...existing,
      auth,
      displayName: userInfo.name,
      status: 'ACTIVE',
      consecutiveFailures: 0,
      lastError: undefined,
      accounts: matchAccounts(existing.accounts, accounts, nowIso.slice(0, 10)),
      updatedAt: nowIso,
    };
  } else {
    connection = {
      connectionId: deps.newId(),
      provider: 'truelayer',
      displayName: userInfo.name,
      status: 'ACTIVE',
      consecutiveFailures: 0,
      accounts: accounts.map(account => ({ ...account, dedupeId: account.accountUid, startDate: pending.startDate })),
      auth,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
  }

  await deps.store.putConnection(command.userId, connection);
  await deps.store.registerSyncUser(command.userId, nowIso);
  await deps.store.deletePendingAuth(command.userId, command.state);
  return success({ status: 'READY', connection });
}

async function disconnect(deps: WorkerDeps, command: CommandOf<'disconnect'>): Promise<WorkerResult<{ disconnected: true }>> {
  const connection = await deps.store.getConnection(command.userId, command.connectionId);
  if (!connection) return failure('NOT_FOUND', 'Connection not found');

  await deps.store.deletePendingItemsForConnection(command.userId, command.connectionId);
  await deps.store.deleteConnection(command.userId, command.connectionId);
  if ((await deps.store.listConnections(command.userId)).length === 0) {
    await deps.store.unregisterSyncUser(command.userId);
  }
  return success({ disconnected: true as const });
}

async function syncNow(deps: WorkerDeps, command: CommandOf<'syncNow'>): Promise<WorkerResult<UserSyncOutcome>> {
  const results = await runSync(deps, [command.userId], command.psu);
  return success(results[command.userId]);
}

export async function executeWorkerCommand(deps: WorkerDeps, command: WorkerCommand): Promise<WorkerResult<unknown>> {
  try {
    switch (command.command) {
      case 'createConnection': return await createConnection(deps, command);
      case 'completeConnection': return await completeConnection(deps, command);
      case 'syncNow': return await syncNow(deps, command);
      case 'disconnect': return await disconnect(deps, command);
    }
  } catch (error) {
    deps.log('worker.command_failed', { command: command.command, errorType: classifyProviderError(error) });
    return failure('UPSTREAM', UPSTREAM_MESSAGE);
  }
}
