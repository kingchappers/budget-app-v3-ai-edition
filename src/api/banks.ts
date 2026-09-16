import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { WorkerErrorCode } from '../sync/commands';
import { createDynamoSyncStore } from '../sync/stores/dynamoSyncStore';
import type { Connection, PsuContext } from '../sync/types';
import { DATE_RE, UUID_RE, hasOnlyKeys, parseJsonBody } from './body';
import { SECURITY_HEADERS } from './constants';
import { err, ok } from './http';
import type { ApiResponse } from './types';
import { invokeWorker, invokeWorkerAsync } from './worker';

const store = createDynamoSyncStore();

const DAY_MS = 86_400_000;
const MAX_HISTORY_DAYS = 730;
const SYNC_RUNNING_STALE_MS = 10 * 60_000;
const MANUAL_SYNC_COOLDOWN_MS = 5 * 60_000;
const MAX_USER_AGENT_LENGTH = 512;

const WORKER_ERROR_STATUS: Record<WorkerErrorCode, number> = { BAD_REQUEST: 400, NOT_FOUND: 404, UPSTREAM: 502 };

type Params = Record<string, string>;

export type PublicConnection = Omit<Connection, 'auth'> & { needsAttention: boolean };

type CompleteConnectionResult = { status: 'PENDING' } | { status: 'READY'; connection: Connection };

function psuFrom(event: APIGatewayProxyEventV2): PsuContext {
  return {
    ipAddress: event.requestContext.http.sourceIp,
    userAgent: (event.headers?.['user-agent'] ?? '').slice(0, MAX_USER_AGENT_LENGTH),
  };
}

const today = (): string => new Date().toISOString().slice(0, 10);

const empty = (statusCode: number): ApiResponse => ({ statusCode, headers: SECURITY_HEADERS, body: '' });

export function validateStartDate(value: unknown, todayIso: string): string | null {
  if (typeof value !== 'string' || !DATE_RE.test(value)) return 'startDate must be in YYYY-MM-DD format';
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) return 'startDate must be in YYYY-MM-DD format';
  if (value > todayIso) return 'startDate cannot be in the future';
  const earliest = new Date(Date.parse(`${todayIso}T00:00:00Z`) - MAX_HISTORY_DAYS * DAY_MS).toISOString().slice(0, 10);
  if (value < earliest) return 'startDate cannot be more than 2 years ago';
  return null;
}

export function toPublicConnection(connection: Connection, _nowMs: number): PublicConnection {
  const { auth: _auth, ...rest } = connection;
  const needsAttention = connection.status === 'EXPIRED' || connection.status === 'ERROR';
  return { ...rest, needsAttention };
}

export async function connectBank(event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const body = parseJsonBody(event);
  if (!body || !hasOnlyKeys(body, ['startDate'], ['connectionId'])) {
    return err(400, 'Body must contain startDate and optional connectionId');
  }
  const { startDate, connectionId } = body;
  const startDateError = validateStartDate(startDate, today());
  if (startDateError) return err(400, startDateError);
  if (connectionId !== undefined && (typeof connectionId !== 'string' || !UUID_RE.test(connectionId))) {
    return err(400, 'connectionId must be a UUID');
  }

  const result = await invokeWorker<{ url: string }>({
    command: 'createConnection',
    userId,
    startDate: startDate as string,
    ...(typeof connectionId === 'string' ? { connectionId } : {}),
    psu: psuFrom(event),
  });
  if (!result.ok) return err(WORKER_ERROR_STATUS[result.error], result.message);
  return ok({ url: result.value.url });
}

export async function completeBankCallback(event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const body = parseJsonBody(event);
  if (!body || !hasOnlyKeys(body, ['state'])) return err(400, 'Body must contain state');
  const { state } = body;
  if (typeof state !== 'string' || !UUID_RE.test(state)) return err(400, 'Invalid state');

  const psu = psuFrom(event);
  const result = await invokeWorker<CompleteConnectionResult>({ command: 'completeConnection', userId, state, psu });
  if (!result.ok) return err(WORKER_ERROR_STATUS[result.error], result.message);

  if (result.value.status === 'PENDING') {
    return { statusCode: 202, headers: SECURITY_HEADERS, body: JSON.stringify({ status: 'PENDING' }) };
  }

  try {
    await invokeWorkerAsync({ command: 'syncNow', userId, psu });
  } catch (error) {
    console.error(JSON.stringify({ event: 'banks.first_sync_invoke_failed', errorName: error instanceof Error ? error.name : 'unknown' }));
  }

  return {
    statusCode: 201,
    headers: SECURITY_HEADERS,
    body: JSON.stringify({ connection: toPublicConnection(result.value.connection, Date.now()) }),
  };
}

export async function clearPendingAuth(_event: APIGatewayProxyEventV2, userId: string, params: Params): Promise<ApiResponse> {
  if (!UUID_RE.test(params.state ?? '')) return err(400, 'Invalid state');
  await store.deletePendingAuth(userId, params.state);
  return empty(204);
}

export async function listBankConnections(_event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const now = Date.now();
  const connections = await store.listConnections(userId);
  return ok({ connections: connections.map(connection => toPublicConnection(connection, now)) });
}

export async function disconnectBank(_event: APIGatewayProxyEventV2, userId: string, params: Params): Promise<ApiResponse> {
  if (!UUID_RE.test(params.connectionId ?? '')) return err(400, 'connectionId must be a UUID');
  const result = await invokeWorker<{ disconnected: true }>({ command: 'disconnect', userId, connectionId: params.connectionId });
  if (!result.ok) return err(WORKER_ERROR_STATUS[result.error], result.message);
  return empty(204);
}

export async function triggerSync(event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const now = Date.now();
  const status = await store.getSyncStatus(userId);
  if (status?.state === 'RUNNING' && status.startedAt && now - Date.parse(status.startedAt) < SYNC_RUNNING_STALE_MS) {
    return err(409, 'A sync is already running');
  }
  if (status?.finishedAt && now - Date.parse(status.finishedAt) < MANUAL_SYNC_COOLDOWN_MS) {
    return err(429, 'Synced recently. Try again in a few minutes.');
  }
  await invokeWorkerAsync({ command: 'syncNow', userId, psu: psuFrom(event) });
  return { statusCode: 202, headers: SECURITY_HEADERS, body: JSON.stringify({ status: 'STARTED' }) };
}

export async function getSyncStatus(_event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const status = await store.getSyncStatus(userId);
  return ok({ status: status ?? { state: 'IDLE' } });
}
