import { QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { docClient, TABLE, pk, catSk } from './db';
import { DEFAULT_CATEGORY_IDS } from './defaults';
import { ok, err } from './http';
import type { ApiResponse } from './types';

const UPDATE_BATCH_SIZE = 25;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

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
      ExpressionAttributeValues: { ':pk': pk(userId), ':sk': catSk(toCategoryId) },
    }));
    if (!target.Items || target.Items.length === 0) {
      return err(400, 'toCategoryId does not exist');
    }
  }

  const matching: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': 'TXN#' },
      ExclusiveStartKey: lastEvaluatedKey,
    }));

    for (const item of result.Items || []) {
      if (item.categoryId === categoryId) {
        matching.push(item);
      }
    }

    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);

  let reassigned = 0;
  for (const batch of chunk(matching, UPDATE_BATCH_SIZE)) {
    const results = await Promise.all(batch.map(async (item) => {
      try {
        await docClient.send(new UpdateCommand({
          TableName: TABLE,
          Key: { PK: pk(userId), SK: item.SK },
          UpdateExpression: 'SET categoryId = :c',
          ConditionExpression: 'attribute_exists(SK)',
          ExpressionAttributeValues: { ':c': toCategoryId },
        }));
        return true;
      } catch (error) {
        if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
          return false;
        }
        throw error;
      }
    }));
    reassigned += results.filter(Boolean).length;
  }

  return ok({ reassigned });
}
