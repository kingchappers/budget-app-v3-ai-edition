import {
  BatchGetCommand, BatchWriteCommand, DeleteCommand, GetCommand, PutCommand,
  QueryCommand, TransactWriteCommand, UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { QueryCommandInput } from '@aws-sdk/lib-dynamodb';
import {
  docClient, TABLE, pk, bankAuthSk, bankConnSk, connUserSk, inboxSk, seenSk, SYNC_STATUS_SK, SYSTEM_PK,
} from '../../api/db';
import { isCancelledByCondition, isConditionalCheckFailure } from '../../api/dynamoErrors';
import { chunk } from '../chunk';
import type { SyncStore } from '../store';
import type { Connection, InboxItem, PendingAuth, SyncResult, SyncStatus } from '../types';

const BATCH_GET_SIZE = 100;
const BATCH_WRITE_SIZE = 25;
const MAX_UNPROCESSED_RETRIES = 5;

type Key = { PK: string; SK: string };

function withoutKeys<T>(item: Record<string, unknown>): T {
  const { PK: _pk, SK: _sk, ...rest } = item;
  return rest as T;
}

function withoutUndefined<T extends object>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

async function queryAll(input: QueryCommandInput): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({ ...input, ExclusiveStartKey: startKey }));
    items.push(...(result.Items ?? []));
    startKey = result.LastEvaluatedKey;
  } while (startKey);
  return items;
}

async function deleteKeys(keys: Key[]): Promise<void> {
  for (const batch of chunk(keys, BATCH_WRITE_SIZE)) {
    let requests: Record<string, unknown>[] = batch.map(Key => ({ DeleteRequest: { Key } }));
    for (let attempt = 0; requests.length > 0; attempt++) {
      if (attempt > MAX_UNPROCESSED_RETRIES) throw new Error('DynamoDB left unprocessed deletes after retries');
      const result = await docClient.send(new BatchWriteCommand({ RequestItems: { [TABLE]: requests } }));
      requests = (result.UnprocessedItems?.[TABLE] ?? []) as Record<string, unknown>[];
    }
  }
}

export function createDynamoSyncStore(): SyncStore {
  return {
    async listSyncUserIds() {
      const items = await queryAll({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': SYSTEM_PK, ':prefix': 'CONNUSER#' },
      });
      return items.map(item => String(item.SK).slice('CONNUSER#'.length));
    },

    async registerSyncUser(userId, nowIso) {
      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: { PK: SYSTEM_PK, SK: connUserSk(userId), createdAt: nowIso },
      }));
    },

    async unregisterSyncUser(userId) {
      await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { PK: SYSTEM_PK, SK: connUserSk(userId) } }));
    },

    async acquireLock(userId, nowIso, staleBeforeIso) {
      try {
        await docClient.send(new UpdateCommand({
          TableName: TABLE,
          Key: { PK: pk(userId), SK: SYNC_STATUS_SK },
          UpdateExpression: 'SET #state = :running, startedAt = :now',
          ConditionExpression: 'attribute_not_exists(#state) OR #state <> :running OR startedAt < :stale',
          ExpressionAttributeNames: { '#state': 'state' },
          ExpressionAttributeValues: { ':running': 'RUNNING', ':now': nowIso, ':stale': staleBeforeIso },
        }));
        return true;
      } catch (error) {
        if (isConditionalCheckFailure(error)) return false;
        throw error;
      }
    },

    async releaseLock(userId, nowIso, result: SyncResult) {
      await docClient.send(new UpdateCommand({
        TableName: TABLE,
        Key: { PK: pk(userId), SK: SYNC_STATUS_SK },
        UpdateExpression: 'SET #state = :idle, finishedAt = :now, lastResult = :result',
        ExpressionAttributeNames: { '#state': 'state' },
        ExpressionAttributeValues: { ':idle': 'IDLE', ':now': nowIso, ':result': result },
      }));
    },

    async getSyncStatus(userId) {
      const result = await docClient.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: SYNC_STATUS_SK } }));
      return result.Item ? withoutKeys<SyncStatus>(result.Item) : null;
    },

    async listConnections(userId) {
      const items = await queryAll({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'BANKCONN#' },
      });
      return items.map(item => withoutKeys<Connection>(item));
    },

    async getConnection(userId, connectionId) {
      const result = await docClient.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: bankConnSk(connectionId) } }));
      return result.Item ? withoutKeys<Connection>(result.Item) : null;
    },

    async putConnection(userId, connection) {
      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: { PK: pk(userId), SK: bankConnSk(connection.connectionId), ...withoutUndefined(connection) },
      }));
    },

    async replaceConnectionIfUnchanged(userId, connection, expectedUpdatedAt) {
      try {
        await docClient.send(new PutCommand({
          TableName: TABLE,
          Item: { PK: pk(userId), SK: bankConnSk(connection.connectionId), ...withoutUndefined(connection) },
          ConditionExpression: 'updatedAt = :expected',
          ExpressionAttributeValues: { ':expected': expectedUpdatedAt },
        }));
        return true;
      } catch (error) {
        if (isConditionalCheckFailure(error)) return false;
        throw error;
      }
    },

    async deleteConnection(userId, connectionId) {
      await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: bankConnSk(connectionId) } }));
    },

    async putPendingAuth(userId, auth: PendingAuth) {
      await docClient.send(new PutCommand({
        TableName: TABLE,
        Item: { PK: pk(userId), SK: bankAuthSk(auth.state), ...withoutUndefined(auth) },
      }));
    },

    async getPendingAuth(userId, state, nowMs) {
      const result = await docClient.send(new GetCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: bankAuthSk(state) } }));
      if (!result.Item || Number(result.Item.expiresAt) <= Math.floor(nowMs / 1000)) return null;
      return withoutKeys<PendingAuth>(result.Item);
    },

    async deletePendingAuth(userId, state) {
      await docClient.send(new DeleteCommand({ TableName: TABLE, Key: { PK: pk(userId), SK: bankAuthSk(state) } }));
    },

    async filterUnseen(userId, txnKeys) {
      const unseen = new Set(txnKeys);
      for (const batch of chunk([...unseen], BATCH_GET_SIZE)) {
        let keys: Key[] = batch.map(txnKey => ({ PK: pk(userId), SK: seenSk(txnKey) }));
        for (let attempt = 0; keys.length > 0; attempt++) {
          if (attempt > MAX_UNPROCESSED_RETRIES) throw new Error('DynamoDB left unprocessed reads after retries');
          const result = await docClient.send(new BatchGetCommand({
            RequestItems: { [TABLE]: { Keys: keys, ProjectionExpression: 'SK' } },
          }));
          for (const found of result.Responses?.[TABLE] ?? []) {
            unseen.delete(String(found.SK).slice('SEEN#'.length));
          }
          keys = (result.UnprocessedKeys?.[TABLE]?.Keys ?? []) as Key[];
        }
      }
      return unseen;
    },

    async importItem(userId, item: InboxItem) {
      try {
        await docClient.send(new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: TABLE,
                Item: { PK: pk(userId), SK: seenSk(item.txnKey), outcome: 'PENDING', firstSeenAt: item.importedAt },
                ConditionExpression: 'attribute_not_exists(SK)',
              },
            },
            {
              Put: {
                TableName: TABLE,
                Item: { PK: pk(userId), SK: inboxSk(item.bookingDate, item.txnKey), ...withoutUndefined(item) },
              },
            },
          ],
        }));
        return 'IMPORTED';
      } catch (error) {
        if (isCancelledByCondition(error, 0)) return 'ALREADY_SEEN';
        throw error;
      }
    },

    async deletePendingItemsForConnection(userId, connectionId) {
      const items = await queryAll({
        TableName: TABLE,
        KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
        FilterExpression: 'connectionId = :connectionId',
        ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'INBOX#', ':connectionId': connectionId },
      });
      const keys = items.flatMap(found => [
        { PK: pk(userId), SK: String(found.SK) },
        { PK: pk(userId), SK: seenSk(String(found.txnKey)) },
      ]);
      await deleteKeys(keys);
      return items.length;
    },
  };
}
