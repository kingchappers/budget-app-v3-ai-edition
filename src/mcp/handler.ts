import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { SECURITY_HEADERS } from '../api/constants';
import { err } from '../api/http';
import type { ApiResponse } from '../api/types';
import { authenticateToken } from '../auth/tokenAuth';
import { touchToken } from '../auth/tokens';
import type { FailureLimiter } from '../auth/failureLimiter';
import type { Store } from '../store';
import { handleMcpBody } from './protocol';
import { createRequestLimiter } from './rateLimit';
import type { McpTool } from './types';

const REQUESTS_PER_MINUTE = 60;
const requestLimiter = createRequestLimiter({ limit: REQUESTS_PER_MINUTE, windowSeconds: 60 });

export interface McpDeps {
  store: Store;
  now: Date;
  tokenFailures: FailureLimiter;
}

function tooManyRequests(): ApiResponse {
  const response = err(429, 'Too many requests');
  return { ...response, headers: { ...response.headers, 'Retry-After': '60' } };
}

function requestBody(event: APIGatewayProxyEventV2): string | undefined {
  if (event.body === undefined) return undefined;
  return event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
}

// Only an access token is accepted here, and scope is enforced per tool, so tokenAccessRejection is not used.
export async function handleMcpRequest(event: APIGatewayProxyEventV2, tools: McpTool[], deps: McpDeps): Promise<ApiResponse> {
  if (event.requestContext.http.method !== 'POST') {
    return { ...err(405, 'Method not allowed'), headers: { ...SECURITY_HEADERS, Allow: 'POST' } };
  }
  // Browsers never call this endpoint; refusing an Origin blocks DNS rebinding.
  if (event.headers?.origin !== undefined) return err(403, 'Forbidden');

  const sourceIp = event.requestContext.http.sourceIp;
  if (deps.tokenFailures.isBlocked(sourceIp)) return tooManyRequests();

  const nowSeconds = Math.floor(deps.now.getTime() / 1000);
  const result = await authenticateToken(event, deps.store, nowSeconds);
  if ('rejection' in result) {
    deps.tokenFailures.recordFailure(sourceIp);
    if (deps.tokenFailures.isBlocked(sourceIp)) return tooManyRequests();
    return result.rejection;
  }

  if (!requestLimiter.allow(result.userId, nowSeconds)) return tooManyRequests();

  try {
    await touchToken(deps.store, result.stored, nowSeconds);
  } catch (error) {
    console.warn('Token last-used update failed:', error instanceof Error ? error.name : 'Error');
  }
  return handleMcpBody(requestBody(event), { userId: result.userId, scope: result.scope, now: deps.now }, tools);
}
