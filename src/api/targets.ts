import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, targetSk } from './db';
import { SECURITY_HEADERS, VALID_PERIODS } from './constants';
import type { CategoryTarget, ApiResponse } from './types';

function ok(body: object): ApiResponse {
  return { statusCode: 200, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

function err(status: number, message: string): ApiResponse {
  return { statusCode: status, headers: SECURITY_HEADERS, body: JSON.stringify({ error: message }) };
}

export async function getTargets(
  _event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'TARGET#' },
  }));

  return ok({ targets: result.Items || [] });
}

export async function upsertTarget(
  event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { categoryId } = params;

  if (!categoryId) {
    return err(400, 'categoryId is required');
  }

  let body: Record<string, unknown>;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return err(400, 'Invalid JSON body');
  }

  const { targetAmount, period } = body;

  if (typeof targetAmount !== 'number' || !Number.isInteger(targetAmount) || targetAmount <= 0) {
    return err(400, 'targetAmount must be a positive integer representing pence/cents');
  }
  if (!period || !VALID_PERIODS.has(period as string)) {
    return err(400, 'period must be MONTHLY or WEEKLY');
  }

  const target: CategoryTarget = {
    categoryId,
    targetAmount,
    period: period as CategoryTarget['period'],
    updatedAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: pk(userId), SK: targetSk(categoryId), ...target },
  }));

  return ok({ target });
}

export async function deleteTarget(
  _event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { categoryId } = params;

  if (!categoryId) {
    return err(400, 'categoryId is required');
  }

  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: pk(userId), SK: targetSk(categoryId) },
  }));

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' };
}
