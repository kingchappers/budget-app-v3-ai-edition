import { describe, it, expect } from 'vitest';
import { createRouter } from '../router';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';

function makeEvent(method: string, path: string, body?: string): APIGatewayProxyEventV2 {
  return {
    rawPath: path,
    requestContext: { http: { method } },
    body,
    headers: {},
    queryStringParameters: {},
    pathParameters: {},
    isBase64Encoded: false,
  } as unknown as APIGatewayProxyEventV2;
}

describe('router', () => {
  it('dispatches to a matching GET route', async () => {
    const router = createRouter();
    router.get('/api/categories', async () => ({
      statusCode: 200, headers: {}, body: '{"ok":true}',
    }));
    const res = await router.dispatch(makeEvent('GET', '/api/categories'), 'user-1');
    expect(res.statusCode).toBe(200);
  });

  it('dispatches to a matching DELETE route with path param', async () => {
    const router = createRouter();
    router.delete('/api/categories/{categoryId}', async (_event, _userId, params) => ({
      statusCode: 204, headers: {}, body: '',
    }));
    const res = await router.dispatch(makeEvent('DELETE', '/api/categories/abc-123'), 'user-1');
    expect(res.statusCode).toBe(204);
  });

  it('extracts path parameters correctly', async () => {
    const router = createRouter();
    let captured: Record<string, string> = {};
    router.delete('/api/transactions/{yearMonth}/{transactionId}', async (_event, _userId, params) => {
      captured = params;
      return { statusCode: 204, headers: {}, body: '' };
    });
    await router.dispatch(makeEvent('DELETE', '/api/transactions/2025-01/txn-uuid'), 'user-1');
    expect(captured).toEqual({ yearMonth: '2025-01', transactionId: 'txn-uuid' });
  });

  it('returns 404 for unknown routes', async () => {
    const router = createRouter();
    const res = await router.dispatch(makeEvent('GET', '/api/unknown'), 'user-1');
    expect(res.statusCode).toBe(404);
  });

  it('does not match a GET route on a POST request', async () => {
    const router = createRouter();
    router.get('/api/categories', async () => ({ statusCode: 200, headers: {}, body: '' }));
    const res = await router.dispatch(makeEvent('POST', '/api/categories'), 'user-1');
    expect(res.statusCode).toBe(404);
  });
});
