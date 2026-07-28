import { QueryCommand, PutCommand, DeleteCommand, GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, txnSk } from './db';
import { SECURITY_HEADERS, VALID_TRANSACTION_TYPES } from './constants';
import type { Transaction, ApiResponse } from './types';
import { ok, err } from './http';

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

export interface ValidTransactionInput {
  amount: number;
  type: Transaction['type'];
  categoryId: string;
  description: string;
  date: string;
}

export function validateTransactionInput(
  body: Record<string, unknown>,
): { ok: true; value: ValidTransactionInput } | { ok: false; message: string } {
  const { amount, type, categoryId, description, date } = body;

  if (typeof amount !== 'number' || !Number.isInteger(amount) || amount <= 0) {
    return { ok: false, message: 'amount must be a positive integer representing pence/cents' };
  }
  if (!type || !VALID_TRANSACTION_TYPES.has(type as string)) {
    return { ok: false, message: 'type must be EXPENSE, INCOME, INVESTMENT_IN, or INVESTMENT_OUT' };
  }
  if (!categoryId || typeof categoryId !== 'string' || categoryId.length > 100) {
    return { ok: false, message: 'categoryId is required' };
  }
  if (description !== undefined && description !== null) {
    if (typeof description !== 'string' || description.length > 200) {
      return { ok: false, message: 'description must be a string of at most 200 characters' };
    }
  }
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return { ok: false, message: 'date must be in YYYY-MM-DD format' };
  }

  return {
    ok: true,
    value: {
      amount,
      type: type as Transaction['type'],
      categoryId,
      description: typeof description === 'string' ? description.trim() : '',
      date,
    },
  };
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

  const validation = validateTransactionInput(body);
  if (!validation.ok) {
    return err(400, validation.message);
  }
  const { amount, type, categoryId, description, date } = validation.value;

  const yearMonth = date.slice(0, 7);
  const transactionId = crypto.randomUUID();

  const transaction: Transaction = {
    transactionId,
    yearMonth,
    amount,
    type,
    categoryId,
    description,
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

export async function updateTransaction(
  event: APIGatewayProxyEventV2,
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

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, 'Invalid JSON body');
  }

  const validation = validateTransactionInput(body);
  if (!validation.ok) {
    return err(400, validation.message);
  }
  const { amount, type, categoryId, description, date } = validation.value;

  const existingResult = await docClient.send(new GetCommand({
    TableName: TABLE,
    Key: { PK: pk(userId), SK: txnSk(yearMonth, transactionId) },
  }));

  const existing = existingResult.Item as Transaction | undefined;
  if (!existing) {
    return err(404, 'Transaction not found');
  }

  const newYearMonth = date.slice(0, 7);
  const transaction: Transaction = {
    transactionId,
    yearMonth: newYearMonth,
    amount,
    type,
    categoryId,
    description,
    date,
    createdAt: existing.createdAt,
  };

  if (newYearMonth === yearMonth) {
    await docClient.send(new PutCommand({
      TableName: TABLE,
      Item: { PK: pk(userId), SK: txnSk(yearMonth, transactionId), ...transaction },
    }));
  } else {
    await docClient.send(new TransactWriteCommand({
      TransactItems: [
        { Delete: { TableName: TABLE, Key: { PK: pk(userId), SK: txnSk(yearMonth, transactionId) } } },
        { Put: { TableName: TABLE, Item: { PK: pk(userId), SK: txnSk(newYearMonth, transactionId), ...transaction } } },
      ],
    }));
  }

  return ok({ transaction });
}
