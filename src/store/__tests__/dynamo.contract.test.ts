import { CreateTableCommand, DeleteTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoStore } from '../dynamo';
import { runStoreContract } from './contract';

const endpoint = process.env.DYNAMODB_ENDPOINT;
const table = `store-contract-${crypto.randomUUID()}`;
const raw = new DynamoDBClient({
  endpoint,
  region: 'eu-west-2',
  credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
});

runStoreContract('DynamoStore (DynamoDB Local)', {
  create: async () => {
    await raw.send(new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      KeySchema: [{ AttributeName: 'PK', KeyType: 'HASH' }, { AttributeName: 'SK', KeyType: 'RANGE' }],
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
      ],
    }));
    const client = DynamoDBDocumentClient.from(raw, { marshallOptions: { removeUndefinedValues: true } });
    return new DynamoStore(client, table);
  },
  destroy: async () => { await raw.send(new DeleteTableCommand({ TableName: table })); },
}, { skip: !endpoint });
