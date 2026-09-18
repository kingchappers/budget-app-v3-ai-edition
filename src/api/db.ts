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
