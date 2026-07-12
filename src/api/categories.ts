import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, catSk } from './db';
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_IDS } from './defaults';
import { SECURITY_HEADERS, VALID_CATEGORY_TYPES } from './constants';
import type { Category, ApiResponse } from './types';

function ok(body: object): ApiResponse {
  return { statusCode: 200, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

function err(status: number, message: string): ApiResponse {
  return { statusCode: status, headers: SECURITY_HEADERS, body: JSON.stringify({ error: message }) };
}

export async function getCategories(
  _event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'CAT#' },
  }));

  const custom = (result.Items || []) as Category[];
  return ok({ categories: [...DEFAULT_CATEGORIES, ...custom] });
}

export async function createCategory(
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

  const { name, type, icon } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 50) {
    return err(400, 'name must be a non-empty string of at most 50 characters');
  }
  if (!type || !VALID_CATEGORY_TYPES.has(type as string)) {
    return err(400, 'type must be EXPENSE, INCOME, or INVESTMENT');
  }

  const categoryId = crypto.randomUUID();
  const category: Category = {
    categoryId,
    name: name.trim(),
    type: type as Category['type'],
    icon: typeof icon === 'string' ? icon.slice(0, 50) : 'default',
    isDefault: false,
    createdAt: new Date().toISOString(),
  };

  await docClient.send(new PutCommand({
    TableName: TABLE,
    Item: { PK: pk(userId), SK: catSk(categoryId), ...category },
  }));

  return { statusCode: 201, headers: SECURITY_HEADERS, body: JSON.stringify({ category }) };
}

export async function deleteCategory(
  _event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
): Promise<ApiResponse> {
  const { categoryId } = params;

  if (!categoryId) {
    return err(400, 'categoryId is required');
  }
  if (DEFAULT_CATEGORY_IDS.has(categoryId)) {
    return err(403, 'Cannot delete a default category');
  }

  await docClient.send(new DeleteCommand({
    TableName: TABLE,
    Key: { PK: pk(userId), SK: catSk(categoryId) },
  }));

  return { statusCode: 204, headers: SECURITY_HEADERS, body: '' };
}
