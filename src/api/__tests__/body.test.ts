import { describe, it, expect } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { hasOnlyKeys, isRecord, parseJsonBody, UUID_RE, DATE_RE } from '../body';

const event = (body?: string) => ({ body } as unknown as APIGatewayProxyEventV2);

describe('isRecord', () => {
  it('accepts plain objects and rejects arrays, null and primitives', () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord('x')).toBe(false);
  });
});

describe('hasOnlyKeys', () => {
  it('requires every required key', () => {
    expect(hasOnlyKeys({ a: 1 }, ['a', 'b'])).toBe(false);
  });

  it('rejects keys outside required and optional', () => {
    expect(hasOnlyKeys({ a: 1, c: 2 }, ['a'], ['b'])).toBe(false);
  });

  it('accepts required plus optional keys', () => {
    expect(hasOnlyKeys({ a: 1, b: 2 }, ['a'], ['b'])).toBe(true);
  });
});

describe('parseJsonBody', () => {
  it('returns the object for a JSON object body', () => {
    expect(parseJsonBody(event('{"a":1}'))).toEqual({ a: 1 });
  });

  it('treats a missing body as an empty object', () => {
    expect(parseJsonBody(event(undefined))).toEqual({});
  });

  it('returns null for invalid JSON or non-object JSON', () => {
    expect(parseJsonBody(event('{nope'))).toBeNull();
    expect(parseJsonBody(event('[1]'))).toBeNull();
  });
});

describe('patterns', () => {
  it('matches UUIDs and ISO dates', () => {
    expect(UUID_RE.test('11111111-1111-4111-8111-111111111111')).toBe(true);
    expect(UUID_RE.test('not-a-uuid')).toBe(false);
    expect(DATE_RE.test('2026-09-13')).toBe(true);
    expect(DATE_RE.test('13/09/2026')).toBe(false);
  });
});
