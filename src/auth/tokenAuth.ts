import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { err } from '../api/http';
import type { ApiResponse } from '../api/types';
import type { Store } from '../store';
import { TOKEN_PATTERN, findToken } from './tokens';
import type { StoredToken, TokenScope } from './tokens';

export type TokenAuthResult =
  | { userId: string; scope: TokenScope; stored: StoredToken }
  | { rejection: ApiResponse };

const BEARER_PREFIX = 'Bearer ';
const TOKEN_PREFIXES = ['Bearer hwr_', 'Bearer hww_'];
const READ_ONLY_METHODS = new Set(['GET', 'HEAD']);
const NON_TOKEN_PATHS = ['/api/auth/', '/api/tokens', '/api/push/'];

function authorizationHeader(event: APIGatewayProxyEventV2): string {
  return event.headers?.authorization ?? '';
}

export function presentsAccessToken(event: APIGatewayProxyEventV2): boolean {
  const header = authorizationHeader(event);
  return TOKEN_PREFIXES.some((prefix) => header.startsWith(prefix));
}

function reject(reason: 'malformed' | 'unknown-or-expired'): { rejection: ApiResponse } {
  console.warn('Token auth rejected:', reason);
  return { rejection: err(401, 'Unauthorized') };
}

export async function authenticateToken(
  event: APIGatewayProxyEventV2,
  store: Store,
  nowSeconds: number,
): Promise<TokenAuthResult> {
  const token = authorizationHeader(event).slice(BEARER_PREFIX.length);
  if (!TOKEN_PATTERN.test(token)) return reject('malformed');

  const stored = await findToken(store, token, nowSeconds);
  if (!stored) return reject('unknown-or-expired');
  return { userId: stored.userId, scope: stored.scope, stored };
}

export function tokenAccessRejection(scope: TokenScope, method: string, path: string): ApiResponse | undefined {
  if (NON_TOKEN_PATHS.some((prefix) => path.startsWith(prefix))) {
    return err(403, 'Not available to access tokens');
  }
  if (scope === 'read' && !READ_ONLY_METHODS.has(method)) {
    return err(403, 'This token is read-only');
  }
  return undefined;
}
