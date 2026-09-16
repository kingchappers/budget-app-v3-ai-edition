import { GetCommand, QueryCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { InboxItem } from '../sync/types';
import { DATE_RE, hasOnlyKeys, isRecord, parseJsonBody } from './body';
import { SECURITY_HEADERS } from './constants';
import { docClient, TABLE, pk, txnSk, inboxSk, seenSk } from './db';
import { isCancelledByCondition } from './dynamoErrors';
import { err, ok } from './http';
import { validateTransactionInput } from './transactions';
import type { ApiResponse, Transaction } from './types';

export const INBOX_PAGE_SIZE = 50;
const TXN_KEY_RE = /^[0-9a-f]{32}$/;

type Params = Record<string, string>;

function withoutKeys(item: Record<string, unknown>): InboxItem {
  const { PK: _pk, SK: _sk, ...rest } = item;
  return rest as unknown as InboxItem;
}

export function encodeCursor(key: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(key)).toString('base64url');
}

export function decodeCursor(cursor: string, userId: string): { PK: string; SK: string } | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (!isRecord(parsed) || !hasOnlyKeys(parsed, ['PK', 'SK'])) return null;
    if (parsed.PK !== pk(userId) || typeof parsed.SK !== 'string' || !parsed.SK.startsWith('INBOX#')) return null;
    return { PK: parsed.PK, SK: parsed.SK };
  } catch {
    return null;
  }
}

function validItemParams(params: Params): boolean {
  return DATE_RE.test(params.bookingDate ?? '') && TXN_KEY_RE.test(params.txnKey ?? '');
}

export async function getInbox(event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  const rawCursor = event.queryStringParameters?.cursor;
  const startKey = rawCursor ? decodeCursor(rawCursor, userId) : undefined;
  if (startKey === null) return err(400, 'Invalid cursor');

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'INBOX#' },
    ScanIndexForward: false,
    Limit: INBOX_PAGE_SIZE,
    ExclusiveStartKey: startKey,
  }));

  return ok({
    items: (result.Items ?? []).map(withoutKeys),
    ...(result.LastEvaluatedKey ? { cursor: encodeCursor(result.LastEvaluatedKey) } : {}),
  });
}

export async function getInboxCount(_event: APIGatewayProxyEventV2, userId: string, _params: Params): Promise<ApiResponse> {
  let count = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'INBOX#' },
      Select: 'COUNT',
      ExclusiveStartKey: startKey,
    }));
    count += result.Count ?? 0;
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return ok({ count });
}

export async function confirmInboxItem(event: APIGatewayProxyEventV2, userId: string, params: Params): Promise<ApiResponse> {
  if (!validItemParams(params)) return err(400, 'Invalid inbox item reference');
  const body = parseJsonBody(event);
  if (!body || !hasOnlyKeys(body, ['type', 'categoryId'], ['description'])) {
    return err(400, 'Body must contain type, categoryId and optional description');
  }

  const { bookingDate, txnKey } = params;
  const found = await docClient.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: inboxSk(bookingDate, txnKey) } }));
  if (!found.Item) return err(404, 'Inbox item not found');
  const item = withoutKeys(found.Item);

  const validation = validateTransactionInput({
    amount: item.amount,
    type: body.type,
    categoryId: body.categoryId,
    description: body.description ?? item.description,
    date: item.bookingDate,
  });
  if (validation.ok === false) return err(400, validation.message);

  const yearMonth = item.bookingDate.slice(0, 7);
  const transaction: Transaction = {
    transactionId: txnKey,
    yearMonth,
    ...validation.value,
    createdAt: new Date().toISOString(),
    source: 'BANK',
    bankRef: { connectionId: item.connectionId, accountUid: item.accountUid, txnKey },
  };

  try {
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Put: {
            TableName: TABLE,
            Item: { PK: pk(userId), SK: txnSk(yearMonth, txnKey), ...transaction },
            ConditionExpression: 'attribute_not_exists(SK)',
          },
        },
        {
          Delete: {
            TableName: TABLE,
            Key: { PK: pk(userId), SK: inboxSk(bookingDate, txnKey) },
            ConditionExpression: 'attribute_exists(SK)',
          },
        },
        {
          Update: {
            TableName: TABLE,
            Key: { PK: pk(userId), SK: seenSk(txnKey) },
            UpdateExpression: 'SET #outcome = :outcome',
            ExpressionAttributeNames: { '#outcome': 'outcome' },
            ExpressionAttributeValues: { ':outcome': 'CONFIRMED' },
          },
        },
      ],
    }));
  } catch (error) {
    if (isCancelledByCondition(error, 0)) return err(409, 'Transaction already exists');
    if (isCancelledByCondition(error, 1)) return err(404, 'Inbox item not found');
    throw error;
  }

  return { statusCode: 201, headers: SECURITY_HEADERS, body: JSON.stringify({ transaction }) };
}

export async function ignoreInboxItem(_event: APIGatewayProxyEventV2, userId: string, params: Params): Promise<ApiResponse> {
  if (!validItemParams(params)) return err(400, 'Invalid inbox item reference');
  const { bookingDate, txnKey } = params;

  try {
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        {
          Delete: {
            TableName: TABLE,
            Key: { PK: pk(userId), SK: inboxSk(bookingDate, txnKey) },
            ConditionExpression: 'attribute_exists(SK)',
          },
        },
        {
          Update: {
            TableName: TABLE,
            Key: { PK: pk(userId), SK: seenSk(txnKey) },
            UpdateExpression: 'SET #outcome = :outcome',
            ExpressionAttributeNames: { '#outcome': 'outcome' },
            ExpressionAttributeValues: { ':outcome': 'IGNORED' },
          },
        },
      ],
    }));
  } catch (error) {
    if (isCancelledByCondition(error, 0)) return err(404, 'Inbox item not found');
    throw error;
  }

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' };
}
