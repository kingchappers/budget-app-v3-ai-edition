import { QueryCommand, PutCommand, DeleteCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, catSk } from './db';
import { DEFAULT_CATEGORIES, DEFAULT_CATEGORY_IDS } from './defaults';
import { SECURITY_HEADERS, VALID_CATEGORY_TYPES, VALID_CATEGORY_GROUPS, POT_GROUPS } from './constants';
import type { Category, CategoryGroup, CategoryType, ApiResponse } from './types';
import { ok, err } from './http';

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

function defaultGroupFor(type: CategoryType): CategoryGroup | undefined {
  if (type === 'INCOME') return undefined;
  if (type === 'POT') return 'SINKING_FUNDS';
  return 'EVERYDAY';
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

  const { name, type, icon, group } = body;

  if (!name || typeof name !== 'string' || name.trim().length === 0 || name.length > 50) {
    return err(400, 'name must be a non-empty string of at most 50 characters');
  }
  if (!type || !VALID_CATEGORY_TYPES.has(type as string)) {
    return err(400, 'type must be EXPENSE, INCOME, or POT');
  }
  if (group !== undefined) {
    if (type === 'INCOME') {
      return err(400, 'group is not allowed for INCOME categories');
    }
    if (typeof group !== 'string' || !VALID_CATEGORY_GROUPS.has(group)) {
      return err(400, 'group must be BILLS, SINKING_FUNDS, EVERYDAY, or SAVING_INVESTMENT');
    }
    if (type === 'POT' && !POT_GROUPS.has(group)) {
      return err(400, 'POT categories must use the SINKING_FUNDS or SAVING_INVESTMENT group');
    }
    if (type === 'EXPENSE' && POT_GROUPS.has(group)) {
      return err(400, 'EXPENSE categories cannot use the SINKING_FUNDS or SAVING_INVESTMENT group');
    }
  }

  const resolvedGroup = (group as CategoryGroup | undefined) ?? defaultGroupFor(type as CategoryType);
  const categoryId = crypto.randomUUID();
  const category: Category = {
    categoryId,
    name: name.trim(),
    type: type as Category['type'],
    icon: typeof icon === 'string' ? icon.slice(0, 50) : 'default',
    isDefault: false,
    createdAt: new Date().toISOString(),
  };
  if (resolvedGroup) category.group = resolvedGroup;

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
