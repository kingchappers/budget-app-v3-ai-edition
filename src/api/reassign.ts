import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk } from './db';
import { DEFAULT_CATEGORY_IDS } from './defaults';
import { ok, err } from './http';
import type { ApiResponse } from './types';

export async function reassignCategory(
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

  const toCategoryId = body.toCategoryId;
  if (!toCategoryId || typeof toCategoryId !== 'string') {
    return err(400, 'toCategoryId is required');
  }
  if (toCategoryId === categoryId) {
    return err(400, 'toCategoryId must differ from the category being reassigned');
  }

  if (!DEFAULT_CATEGORY_IDS.has(toCategoryId)) {
    const target = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND SK = :sk',
      ExpressionAttributeValues: { ':pk': pk(userId), ':sk': `CAT#${toCategoryId}` },
    }));
    if (!target.Items || target.Items.length === 0) {
      return err(400, 'toCategoryId does not exist');
    }
  }

  const result = await docClient.send(new QueryCommand({
    TableName: TABLE,
    KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
    ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'TXN#' },
  }));

  const matching = (result.Items || []).filter(item => item.categoryId === categoryId);

  for (const item of matching) {
    await docClient.send(new UpdateCommand({
      TableName: TABLE,
      Key: { PK: pk(userId), SK: item.SK },
      UpdateExpression: 'SET categoryId = :c',
      ExpressionAttributeValues: { ':c': toCategoryId },
    }));
  }

  return ok({ reassigned: matching.length });
}
