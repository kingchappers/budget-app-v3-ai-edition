import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, txnSk } from './db';
import { SECURITY_HEADERS, VALID_TRANSACTION_TYPES } from './constants';
import type { Transaction, ApiResponse } from './types';

function ok(body: object): ApiResponse {
  return { statusCode: 200, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

function err(status: number, message: string): ApiResponse {
  return { statusCode: status, headers: SECURITY_HEADERS, body: JSON.stringify({ error: message }) };
}

export async function getTransactions(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const qs = event.queryStringParameters || {};
  const { year, month } = qs;

  if (!year || !month) {
    return err(400, 'year and month query parameters are required');
  }

  const yearNum = parseInt(year, 10);
  const monthNum = parseInt(month, 10);
  if (isNaN(yearNum) || isNaN(monthNum) || monthNum < 1 || monthNum > 12 || yearNum < 2000) {
    return err(400, 'Invalid year or month');
  }

  const yearMonth = `${year}-${month.padStart(2, '0')}`;

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': `TXN#${yearMonth}` },
  }));

  return ok({ transactions: result.Items || [] });
}

export async function createTransaction(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, 'Invalid JSON body');
  }

  const { amount, type, categoryId, description, date } = body;

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return err(400, 'amount must be a positive integer representing pence/cents');
  }
  if (!type || !VALID_TRANSACTION_TYPES.has(type as string)) {
    return err(400, 'type must be EXPENSE, INCOME, INVESTMENT_GAIN, or INVESTMENT_LOSS');
  }
  if (!categoryId || typeof categoryId !== 'string' || categoryId.length > 100) {
    return err(400, 'categoryId is required');
  }
  if (!description || typeof description !== 'string' || description.trim().length === 0 || description.length > 200) {
    return err(400, 'description must be a non-empty string of at most 200 characters');
  }
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return err(400, 'date must be in YYYY-MM-DD format');
  }

  const yearMonth = date.slice(0, 7);
  const transactionId = crypto.randomUUID();

  const transaction: Transaction = {
    transactionId,
    yearMonth,
    amount,
    type: type as Transaction['type'],
    categoryId: categoryId as string,
    description: description.trim(),
    date,
    createdAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: pk(userId), SK: txnSk(yearMonth, transactionId), ...transaction },
  }));

  return { statusCode: 201, headers: SECURITY_HEADERS, body: JSON.stringify({ transaction }) };
}

export async function deleteTransaction(
  _event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { yearMonth, transactionId } = params;

  if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
    return err(400, 'yearMonth must be in YYYY-MM format');
  }
  if (!transactionId) {
    return err(400, 'transactionId is required');
  }

  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: pk(userId), SK: txnSk(yearMonth, transactionId) },
  }));

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' };
}
