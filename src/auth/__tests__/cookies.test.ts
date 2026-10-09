import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { clearedCookie, originAllowed, readSessionCookie, sessionCookie } from '../cookies';
import { SESSION_LIFETIME_SECONDS } from '../localData';

function event(over: { method?: string; headers?: Record<string, string>; cookies?: string[] } = {}): APIGatewayProxyEventV2 {
  return {
    headers: over.headers ?? {},
    cookies: over.cookies,
    requestContext: { http: { method: over.method ?? 'GET' } },
  } as unknown as APIGatewayProxyEventV2;
}

describe('readSessionCookie', () => {
  it('reads the API Gateway cookies array', () => {
    expect(readSessionCookie(event({ cookies: ['theme=dark', 'budget_session=abc'] }))).toBe('abc');
  });

  it('reads a Cookie header when there is no cookies array', () => {
    expect(readSessionCookie(event({ headers: { cookie: 'a=1; budget_session=xyz; b=2' } }))).toBe('xyz');
  });

  it('keeps an = inside the value', () => {
    expect(readSessionCookie(event({ cookies: ['budget_session=ab=cd'] }))).toBe('ab=cd');
  });

  it('uses the first of duplicate cookies, so a later one cannot override it', () => {
    expect(readSessionCookie(event({ cookies: ['budget_session=first', 'budget_session=second'] }))).toBe('first');
  });

  it('is undefined with no cookie, an empty value, or a lookalike name', () => {
    expect(readSessionCookie(event())).toBeUndefined();
    expect(readSessionCookie(event({ cookies: ['budget_session='] }))).toBeUndefined();
    expect(readSessionCookie(event({ cookies: ['xbudget_session=abc'] }))).toBeUndefined();
  });
});

describe('cookie formatting', () => {
  it('sets HttpOnly, SameSite=Strict, Path=/ and a 30-day Max-Age', () => {
    const cookie = sessionCookie('tok', true);
    expect(cookie).toContain('budget_session=tok');
    for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Secure', `Max-Age=${SESSION_LIFETIME_SECONDS}`]) {
      expect(cookie).toContain(part);
    }
  });

  it('omits Secure only when asked to', () => {
    expect(sessionCookie('tok', false)).not.toContain('Secure');
  });

  it('clears with Max-Age=0', () => {
    expect(clearedCookie(true)).toContain('Max-Age=0');
    expect(clearedCookie(true)).toContain('budget_session=;');
  });
});

describe('originAllowed', () => {
  const host = { host: 'budget.example.com' };

  it.each(['GET', 'HEAD', 'OPTIONS'])('does not ask %s requests for an Origin', method => {
    expect(originAllowed(event({ method, headers: host }))).toBe(true);
  });

  it('accepts a state-changing request from the same host', () => {
    expect(originAllowed(event({ method: 'POST', headers: { ...host, origin: 'https://budget.example.com' } }))).toBe(true);
  });

  it.each([
    ['no Origin', {}],
    ['a null Origin', { origin: 'null' }],
    ['another host', { origin: 'https://evil.example.com' }],
    ['the same host on another port', { origin: 'https://budget.example.com:8443' }],
    ['an unparseable Origin', { origin: 'not a url' }],
  ])('refuses a POST with %s', (_label, extra) => {
    expect(originAllowed(event({ method: 'POST', headers: { ...host, ...extra } }))).toBe(false);
  });

  it('refuses when there is no host to compare with', () => {
    expect(originAllowed(event({ method: 'POST', headers: { origin: 'https://budget.example.com' } }))).toBe(false);
  });

  it('prefers x-forwarded-host behind a proxy', () => {
    const headers = { host: 'internal:3000', 'x-forwarded-host': 'budget.example.com', origin: 'https://budget.example.com' };
    expect(originAllowed(event({ method: 'DELETE', headers }))).toBe(true);
  });
});
