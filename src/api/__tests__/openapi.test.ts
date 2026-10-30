import { describe, it, expect } from 'vitest';
import { Validator } from '@seriousme/openapi-schema-validator';
import { loadSpec } from './openapiSpec';

describe('docs/openapi.yaml', () => {
  const spec = loadSpec();

  it('is valid OpenAPI 3.1', async () => {
    const result = await new Validator().validate(spec);
    expect(result.errors ?? []).toEqual([]);
    expect(result.valid).toBe(true);
    expect(spec.openapi).toBe('3.1.0');
  });

  it('declares the bearer token and session cookie security schemes', () => {
    expect(Object.keys(spec.components.securitySchemes)).toEqual(
      expect.arrayContaining(['bearerToken', 'sessionCookie']),
    );
  });
});
