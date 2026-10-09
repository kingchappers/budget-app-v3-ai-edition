import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { SESSION_LIFETIME_SECONDS } from './localData';

export const COOKIE_NAME = 'budget_session';

export function readSessionCookie(event: APIGatewayProxyEventV2): string | undefined {
  // API Gateway v2 hands cookies over as an array; a container adapter may only have the header.
  const raw = event.cookies?.join('; ') ?? event.headers?.cookie ?? '';
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    if (trimmed.slice(0, separator) !== COOKIE_NAME) continue;
    const value = trimmed.slice(separator + 1);
    return value === '' ? undefined : value;
  }
  return undefined;
}

function attributes(secure: boolean, maxAge: number): string {
  return `HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${COOKIE_NAME}=${token}; ${attributes(secure, SESSION_LIFETIME_SECONDS)}`;
}

export function clearedCookie(secure: boolean): string {
  return `${COOKIE_NAME}=; ${attributes(secure, 0)}`;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF defence in depth beside SameSite=Strict: a state-changing request must name our own host as its Origin.
// The scheme is not compared, because behind a TLS-terminating proxy it can legitimately differ.
export function originAllowed(event: APIGatewayProxyEventV2): boolean {
  if (SAFE_METHODS.has(event.requestContext.http.method.toUpperCase())) return true;

  const origin = event.headers?.origin;
  const host = (event.headers?.['x-forwarded-host'] ?? event.headers?.host)?.split(',')[0].trim();
  if (!origin || !host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
