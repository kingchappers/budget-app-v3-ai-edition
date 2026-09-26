import { QueryCommand } from '@aws-sdk/lib-dynamodb';
import { docClient, TABLE, pk } from './db';

export async function queryAll(userId: string, prefix: string): Promise<Record<string, unknown>[]> {
  const items: Record<string, unknown>[] = [];
  let lastEvaluatedKey: Record<string, unknown> | undefined;
  do {
    const result = await docClient.send(new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': pk(userId), ':prefix': prefix },
      ExclusiveStartKey: lastEvaluatedKey,
    }));
    items.push(...(result.Items || []));
    lastEvaluatedKey = result.LastEvaluatedKey as Record<string, unknown> | undefined;
  } while (lastEvaluatedKey);
  return items;
}
