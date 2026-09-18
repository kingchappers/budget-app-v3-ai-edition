import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }));

vi.mock('../../api/db', () => ({
  docClient: { send: mockSend },
  TABLE: 'test-table',
  pk: (userId: string) => `USER#${userId}`,
  bankConnSk: (id: string) => `BANKCONN#${id}`,
  bankAuthSk: (state: string) => `BANKAUTH#${state}`,
  inboxSk: (date: string, key: string) => `INBOX#${date}#${key}`,
  seenSk: (key: string) => `SEEN#${key}`,
  SYNC_STATUS_SK: 'SYNCSTATUS',
  SYSTEM_PK: 'SYSTEM',
  connUserSk: (userId: string) => `CONNUSER#${userId}`,
}));

vi.mock('@aws-sdk/lib-dynamodb', () => {
  const passthrough = (name: string) => vi.fn(function (input: object) { return { __command: name, ...input }; });
  return {
    BatchGetCommand: passthrough('BatchGet'),
    BatchWriteCommand: passthrough('BatchWrite'),
    DeleteCommand: passthrough('Delete'),
    GetCommand: passthrough('Get'),
    PutCommand: passthrough('Put'),
    QueryCommand: passthrough('Query'),
    TransactWriteCommand: passthrough('TransactWrite'),
    UpdateCommand: passthrough('Update'),
  };
});

import { createDynamoSyncStore } from '../stores/dynamoSyncStore';
import type { InboxItem } from '../types';

const named = (name: string, extra: object = {}) => Object.assign(new Error(name), { name, ...extra });

const item: InboxItem = {
  txnKey: 'a'.repeat(32), amount: 1234, direction: 'OUT', suggestedType: 'EXPENSE',
  description: 'TESCO', bookingDate: '2026-09-10', connectionId: 'conn-1',
  accountUid: 'acc-1', importedAt: '2026-09-13T12:00:00.000Z',
};

describe('dynamoSyncStore', () => {
  const store = createDynamoSyncStore();
  beforeEach(() => { mockSend.mockReset(); });

  describe('acquireLock', () => {
    it('conditionally sets RUNNING unless a fresh lock is held', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(store.acquireLock('u1', '2026-09-13T12:00:00.000Z', '2026-09-13T11:50:00.000Z')).resolves.toBe(true);
      const input = mockSend.mock.calls[0][0];
      expect(input.Key).toEqual({ PK: 'USER#u1', SK: 'SYNCSTATUS' });
      expect(input.ConditionExpression).toBe('attribute_not_exists(#state) OR #state <> :running OR startedAt < :stale');
      expect(input.ExpressionAttributeValues[':stale']).toBe('2026-09-13T11:50:00.000Z');
    });

    it('returns false when the condition fails', async () => {
      mockSend.mockRejectedValueOnce(named('ConditionalCheckFailedException'));
      await expect(store.acquireLock('u1', 'now', 'stale')).resolves.toBe(false);
    });
  });

  describe('importItem', () => {
    it('writes the seen marker with attribute_not_exists and the inbox item in one transaction', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(store.importItem('u1', item)).resolves.toBe('IMPORTED');
      const [seen, inbox] = mockSend.mock.calls[0][0].TransactItems;
      expect(seen.Put.Item).toMatchObject({ PK: 'USER#u1', SK: `SEEN#${item.txnKey}`, outcome: 'PENDING' });
      expect(seen.Put.ConditionExpression).toBe('attribute_not_exists(SK)');
      expect(inbox.Put.Item).toMatchObject({ PK: 'USER#u1', SK: `INBOX#2026-09-10#${item.txnKey}`, amount: 1234 });
    });

    it('reports ALREADY_SEEN when the seen marker condition cancels the transaction', async () => {
      mockSend.mockRejectedValueOnce(named('TransactionCanceledException', {
        CancellationReasons: [{ Code: 'ConditionalCheckFailed' }, { Code: 'None' }],
      }));
      await expect(store.importItem('u1', item)).resolves.toBe('ALREADY_SEEN');
    });
  });

  describe('filterUnseen', () => {
    it('removes keys that already have a seen marker', async () => {
      mockSend.mockResolvedValueOnce({ Responses: { 'test-table': [{ SK: 'SEEN#k1' }] } });
      const unseen = await store.filterUnseen('u1', ['k1', 'k2']);
      expect([...unseen]).toEqual(['k2']);
      expect(mockSend.mock.calls[0][0].RequestItems['test-table'].Keys).toEqual([
        { PK: 'USER#u1', SK: 'SEEN#k1' },
        { PK: 'USER#u1', SK: 'SEEN#k2' },
      ]);
    });

    it('makes no request for an empty key list', async () => {
      await store.filterUnseen('u1', []);
      expect(mockSend).not.toHaveBeenCalled();
    });
  });

  describe('getPendingAuth', () => {
    it('returns null once expiresAt has passed even if TTL has not deleted the item', async () => {
      mockSend.mockResolvedValueOnce({ Item: { PK: 'USER#u1', SK: 'BANKAUTH#s', state: 's', expiresAt: 1000 } });
      await expect(store.getPendingAuth('u1', 's', 1_000_000)).resolves.toBeNull();
    });

    it('returns the auth without table keys while valid', async () => {
      mockSend.mockResolvedValueOnce({ Item: { PK: 'USER#u1', SK: 'BANKAUTH#s', state: 's', expiresAt: 2000 } });
      await expect(store.getPendingAuth('u1', 's', 1_000_000)).resolves.toEqual({ state: 's', expiresAt: 2000 });
    });
  });

  describe('replaceConnectionIfUnchanged', () => {
    const connection = {
      connectionId: 'c1', provider: 'truelayer' as const, displayName: 'Lloyds', status: 'ACTIVE' as const,
      consecutiveFailures: 0, accounts: [], createdAt: 't0', updatedAt: 't2',
      auth: { providerConnectionId: 'tl-conn-1' }, lastError: undefined,
    };

    it('puts conditionally on the previous updatedAt and drops undefined fields', async () => {
      mockSend.mockResolvedValueOnce({});
      await expect(store.replaceConnectionIfUnchanged('u1', connection, 't1')).resolves.toBe(true);
      const input = mockSend.mock.calls[0][0];
      expect(input.ConditionExpression).toBe('updatedAt = :expected');
      expect(input.ExpressionAttributeValues).toEqual({ ':expected': 't1' });
      expect('lastError' in input.Item).toBe(false);
    });

    it('returns false when the connection changed', async () => {
      mockSend.mockRejectedValueOnce(named('ConditionalCheckFailedException'));
      await expect(store.replaceConnectionIfUnchanged('u1', connection, 't1')).resolves.toBe(false);
    });
  });

  describe('deletePendingItemsForConnection', () => {
    it('deletes matching inbox items and their seen markers', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [{ SK: 'INBOX#2026-09-10#k1', txnKey: 'k1', connectionId: 'c1' }] })
        .mockResolvedValueOnce({});
      await expect(store.deletePendingItemsForConnection('u1', 'c1')).resolves.toBe(1);
      const requests = mockSend.mock.calls[1][0].RequestItems['test-table'];
      expect(requests).toEqual([
        { DeleteRequest: { Key: { PK: 'USER#u1', SK: 'INBOX#2026-09-10#k1' } } },
        { DeleteRequest: { Key: { PK: 'USER#u1', SK: 'SEEN#k1' } } },
      ]);
    });
  });

  describe('listSyncUserIds', () => {
    it('reads the SYSTEM registry across pages', async () => {
      mockSend
        .mockResolvedValueOnce({ Items: [{ SK: 'CONNUSER#a' }], LastEvaluatedKey: { PK: 'SYSTEM', SK: 'CONNUSER#a' } })
        .mockResolvedValueOnce({ Items: [{ SK: 'CONNUSER#b' }] });
      await expect(store.listSyncUserIds()).resolves.toEqual(['a', 'b']);
    });
  });
});
