import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { SESSION_LIFETIME_SECONDS } from './localData';

const PLAIN_COOKIE_NAME = 'hoardwise_session';
// Browsers refuse to let a sibling subdomain set a __Host- cookie (cookie tossing). The prefix requires Secure, Path=/ and no Domain.
const HOST_COOKIE_NAME = '__Host-hoardwise_session';

export function cookieName(secure: boolean): string {
  return secure ? HOST_COOKIE_NAME : PLAIN_COOKIE_NAME;
}

export function readSessionCookie(event: APIGatewayProxyEventV2, secure: boolean): string | undefined {
  const name = cookieName(secure);
  // API Gateway v2 hands cookies over as an array; a container adapter may only have the header.
  const raw = event.cookies?.join('; ') ?? event.headers?.cookie ?? '';
  for (const part of raw.split(';')) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    if (trimmed.slice(0, separator) !== name) continue;
    const value = trimmed.slice(separator + 1);
    return value === '' ? undefined : value;
  }
  return undefined;
}

function attributes(secure: boolean, maxAge: number): string {
  return `HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
}

export function sessionCookie(token: string, secure: boolean): string {
  return `${cookieName(secure)}=${token}; ${attributes(secure, SESSION_LIFETIME_SECONDS)}`;
}

export function clearedCookie(secure: boolean): string {
  return `${cookieName(secure)}=; ${attributes(secure, 0)}`;
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// CSRF defence in depth beside SameSite=Strict: a state-changing request must come from our own origin.
// When APP_ORIGIN is configured it is the only accepted origin (scheme, host and port), so a client-controlled Host header
// cannot help a DNS-rebinding page. Without it, the Origin host must equal the request host. The scheme is then not compared,
// because behind a TLS-terminating proxy it can legitimately differ.
export function originAllowed(event: APIGatewayProxyEventV2, appOrigin?: string): boolean {
  if (SAFE_METHODS.has(event.requestContext.http.method.toUpperCase())) return true;

  const origin = event.headers?.origin;
  if (!origin) return false;

  if (appOrigin) {
    try {
      return new URL(origin).origin === new URL(appOrigin).origin;
    } catch {
      return false;
    }
  }

  // x-forwarded-host is trusted only because this is a defence-in-depth check beside SameSite=Strict.
  const host = (event.headers?.['x-forwarded-host'] ?? event.headers?.host)?.split(',')[0].trim().toLowerCase();
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}
