import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk } from './db';
import { queryAll } from './pots';
import type { ApiResponse } from './types';
import { ok, err, parseJsonObject } from './http';

export const TRASH_ENTITIES = {
  TRANSACTION: 'TXN#',
  TARGET: 'TARGET#',
  RECURRING: 'RECUR#',
  ACCOUNT: 'ACCOUNT#',
} as const;

export type TrashEntityType = keyof typeof TRASH_ENTITIES;

export const TRASH_RETENTION_SECONDS = 30 * 24 * 60 * 60;

const TRASH_PREFIX = 'TRASH#';
const ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
const TRANSACTION_ID_PATTERN = /^\d{4}-(0[1-9]|1[0-2])#[A-Za-z0-9_-]{1,100}$/;
const RESTORE_FIELDS = new Set(['entityType', 'id']);

export interface TrashEntry {
  entityType: TrashEntityType;
  id: string;
  item: Record<string, unknown>;
  deletedAt: string;
  expiresAt: number;
}

export interface RestoreInput {
  entityType: TrashEntityType;
  id: string;
}

type RestoreValidation = { ok: true; value: RestoreInput } | { ok: false; message: string };

function isTrashEntityType(value: unknown): value is TrashEntityType {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TRASH_ENTITIES, value);
}

function trashSk(entityType: TrashEntityType, id: string): string {
  return `${TRASH_PREFIX}${entityType}#${id}`;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function withoutKeys(item: Record<string, unknown>): Record<string, unknown> {
  const { PK: _pk, SK: _sk, ...rest } = item;
  return rest;
}

function cancellationCodes(error: unknown): string[] | null {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') return null;
  const reasons = (error as Error & { CancellationReasons?: { Code?: string }[] }).CancellationReasons ?? [];
  return reasons.map(reason => reason.Code ?? 'None');
}

export function validateRestoreInput(body: Record<string, unknown>): RestoreValidation {
  const unexpected = Object.keys(body).filter(key => !RESTORE_FIELDS.has(key));
  if (unexpected.length > 0) {
    return { ok: false, message: 'Only entityType and id are allowed' };
  }
  const { entityType, id } = body;
  if (!isTrashEntityType(entityType)) {
    return { ok: false, message: `entityType must be one of ${Object.keys(TRASH_ENTITIES).join(', ')}` };
  }
  const pattern = entityType === 'TRANSACTION' ? TRANSACTION_ID_PATTERN : ID_PATTERN;
  if (typeof id !== 'string' || !pattern.test(id)) {
    return { ok: false, message: 'id is missing or not in the expected format' };
  }
  return { ok: true, value: { entityType, id } };
}

export async function moveToTrash(userId: string, entityType: TrashEntityType, originalSk: string): Promise<void> {
  const key = { PK: pk(userId), SK: originalSk };
  const existing = await docClient.send(new GetCommand({ TableName: TABLE, Key: key }));
  if (!existing.Item) return;

  const id = originalSk.slice(TRASH_ENTITIES[entityType].length);
  const deletedAtMs = Date.now();
  try {
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: TABLE, Key: key, ConditionExpression: 'attribute_exists(PK)' } },
        {
          Put: {
            TableName: TABLE,
            Item: {
              PK: pk(userId),
              SK: trashSk(entityType, id),
              entityType,
              originalSk,
              item: withoutKeys(existing.Item),
              deletedAt: new Date(deletedAtMs).toISOString(),
              expiresAt: Math.floor(deletedAtMs / 1000) + TRASH_RETENTION_SECONDS,
            },
          },
        },
      ],
    }));
  } catch (error) {
    if (cancellationCodes(error)?.[0] === 'ConditionalCheckFailed') return;
    throw error;
  }
}

function toTrashEntry(record: Record<string, unknown>): TrashEntry | null {
  const { entityType, originalSk, item, deletedAt, expiresAt } = record;
  if (!isTrashEntityType(entityType)) return null;
  if (typeof originalSk !== 'string' || typeof deletedAt !== 'string' || typeof expiresAt !== 'number') return null;
  if (typeof item !== 'object' || item === null) return null;
  return {
    entityType,
    id: originalSk.slice(TRASH_ENTITIES[entityType].length),
    item: item as Record<string, unknown>,
    deletedAt,
    expiresAt,
  };
}

function isLive(entry: TrashEntry, now: number): boolean {
  return entry.expiresAt > now;
}

export async function getTrash(
  _event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const records = await queryAll(userId, TRASH_PREFIX);
  const now = nowSeconds();
  const items = records
    .map(toTrashEntry)
    .filter((entry): entry is TrashEntry => entry !== null && isLive(entry, now))
    .sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return ok({ items });
}

export async function restoreFromTrash(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const body = parseJsonObject(event);
  if (!body) return err(400, 'Invalid JSON body');

  const validation = validateRestoreInput(body);
  if (validation.ok === false) return err(400, validation.message);
  const { entityType, id } = validation.value;

  const trashKey = { PK: pk(userId), SK: trashSk(entityType, id) };
  const result = await docClient.send(new GetCommand({ TableName: TABLE, Key: trashKey }));
  const entry = result.Item ? toTrashEntry(result.Item) : null;
  if (!entry || !isLive(entry, nowSeconds())) {
    return err(404, 'This item is no longer in Recently deleted');
  }

  const originalSk = `${TRASH_ENTITIES[entityType]}${id}`;
  try {
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: { ...entry.item, PK: pk(userId), SK: originalSk },
            ConditionExpression: 'attribute_not_exists(PK)',
          },
        },
        { Delete: { TableName: TABLE, Key: trashKey, ConditionExpression: 'attribute_exists(PK)' } },
      ],
    }));
  } catch (error) {
    const codes = cancellationCodes(error);
    if (codes?.[0] === 'ConditionalCheckFailed') {
      return err(409, 'This item is already in place, so it was not restored');
    }
    if (codes?.[1] === 'ConditionalCheckFailed') {
      return err(404, 'This item is no longer in Recently deleted');
    }
    throw error;
  }

  return ok({ entityType, id, item: entry.item });
}
