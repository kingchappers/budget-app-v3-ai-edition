import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

const client = new DynamoDBClient({ region: process.env.AWS_REGION || 'eu-west-2' });
export const docClient = DynamoDBDocumentClient.from(client);

export const TABLE = process.env.DYNAMODB_TABLE || '';

export const pk = (userId: string): string => `USER#${userId}`;
export const catSk = (categoryId: string): string => `CAT#${categoryId}`;
export const txnSk = (yearMonth: string, transactionId: string): string =>
  `TXN#${yearMonth}#${transactionId}`;
export const targetSk = (categoryId: string): string => `TARGET#${categoryId}`;
export const recurringSk = (recurringId: string): string => `RECUR#${recurringId}`;
export const potSk = (categoryId: string): string => `POT#${categoryId}`;
export const accountSk = (accountId: string): string => `ACCOUNT#${accountId}`;

// Push reminders: each device's subscription lives in the user's own partition, and a
// small index in a partition of its own lets the scheduler find subscribed users with one Query.
export const PUSH_INDEX_PK = 'PUSHIDX';
export const pushSubscriptionSk = (endpointHash: string): string => `PUSHSUB#${endpointHash}`;
export const pushIndexSk = (userId: string): string => `USER#${userId}`;

