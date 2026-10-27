import { describe, expect, it } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { clearedCookie, cookieName, originAllowed, readSessionCookie, sessionCookie } from '../cookies';
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
    expect(readSessionCookie(event({ cookies: ['theme=dark', 'hoardwise_session=abc'] }), false)).toBe('abc');
  });

  it('reads a Cookie header when there is no cookies array', () => {
    expect(readSessionCookie(event({ headers: { cookie: 'a=1; hoardwise_session=xyz; b=2' } }), false)).toBe('xyz');
  });

  it('keeps an = inside the value', () => {
    expect(readSessionCookie(event({ cookies: ['hoardwise_session=ab=cd'] }), false)).toBe('ab=cd');
  });

  it('uses the first of duplicate cookies, so a later one cannot override it', () => {
    expect(readSessionCookie(event({ cookies: ['hoardwise_session=first', 'hoardwise_session=second'] }), false)).toBe('first');
  });

  it('is undefined with no cookie, an empty value, or a lookalike name', () => {
    expect(readSessionCookie(event(), false)).toBeUndefined();
    expect(readSessionCookie(event({ cookies: ['hoardwise_session='] }), false)).toBeUndefined();
    expect(readSessionCookie(event({ cookies: ['xhoardwise_session=abc'] }), false)).toBeUndefined();
  });
});

describe('cookie formatting', () => {
  it('sets HttpOnly, SameSite=Strict, Path=/ and a 30-day Max-Age', () => {
    const cookie = sessionCookie('tok', true);
    expect(cookie).toContain('hoardwise_session=tok');
    for (const part of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Secure', `Max-Age=${SESSION_LIFETIME_SECONDS}`]) {
      expect(cookie).toContain(part);
    }
  });

  it('omits Secure only when asked to', () => {
    expect(sessionCookie('tok', false)).not.toContain('Secure');
  });

  it('clears with Max-Age=0', () => {
    expect(clearedCookie(true)).toContain('Max-Age=0');
    expect(clearedCookie(true)).toContain('hoardwise_session=;');
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

  it('compares the host case-insensitively', () => {
    const headers = { host: 'Budget.Example.COM', origin: 'https://budget.example.com' };
    expect(originAllowed(event({ method: 'POST', headers }))).toBe(true);
    expect(originAllowed(event({ method: 'POST', headers: { ...headers, origin: 'https://evil.example.com' } }))).toBe(false);
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

describe('the __Host- cookie name', () => {
  it('uses the plain name without Secure and the __Host- name with it', () => {
    expect(cookieName(false)).toBe('hoardwise_session');
    expect(cookieName(true)).toBe('__Host-hoardwise_session');
  });

  it('reads only the name for the current mode, so a tossed plain cookie is ignored while Secure', () => {
    const cookies = ['hoardwise_session=tossed', '__Host-hoardwise_session=real'];
    expect(readSessionCookie(event({ cookies }), true)).toBe('real');
    expect(readSessionCookie(event({ cookies: ['hoardwise_session=tossed'] }), true)).toBeUndefined();
    expect(readSessionCookie(event({ cookies: ['__Host-hoardwise_session=real'] }), false)).toBeUndefined();
  });

  it('sets a __Host- cookie with Secure, Path=/ and no Domain', () => {
    const cookie = sessionCookie('tok', true);
    expect(cookie.startsWith('__Host-hoardwise_session=tok;')).toBe(true);
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain');
    expect(clearedCookie(true).startsWith('__Host-hoardwise_session=;')).toBe(true);
  });
});

describe('originAllowed with APP_ORIGIN', () => {
  const post = (headers: Record<string, string>) => event({ method: 'POST', headers });

  it('compares scheme, host and port against APP_ORIGIN and ignores the Host header', () => {
    const appOrigin = 'https://budget.example.com';
    expect(originAllowed(post({ origin: 'https://budget.example.com', host: 'internal:8080' }), appOrigin)).toBe(true);
    expect(originAllowed(post({ origin: 'https://evil.example.com', host: 'evil.example.com' }), appOrigin)).toBe(false);
    expect(originAllowed(post({ origin: 'http://budget.example.com', host: 'budget.example.com' }), appOrigin)).toBe(false);
    expect(originAllowed(post({ origin: 'https://budget.example.com:8443', host: 'budget.example.com' }), appOrigin)).toBe(false);
  });

  it('refuses a missing, null or unparseable Origin, and an unparseable APP_ORIGIN', () => {
    expect(originAllowed(post({ host: 'budget.example.com' }), 'https://budget.example.com')).toBe(false);
    expect(originAllowed(post({ origin: 'null' }), 'https://budget.example.com')).toBe(false);
    expect(originAllowed(post({ origin: 'https://budget.example.com' }), 'not a url')).toBe(false);
  });

  it('still lets safe methods through', () => {
    expect(originAllowed(event({ method: 'GET' }), 'https://budget.example.com')).toBe(true);
  });
});

describe('the names used before 0.3.0', () => {
  it('are no longer accepted as the session', () => {
    expect(readSessionCookie(event({ cookies: ['budget_session=abc'] }), false)).toBeUndefined();
    expect(readSessionCookie(event({ cookies: ['__Host-budget_session=abc'] }), true)).toBeUndefined();
  });
});
