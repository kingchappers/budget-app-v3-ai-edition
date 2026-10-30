import { describe, it, expect } from 'vitest';
import { createRouter } from '../router';
import { createTokenRouter } from '../tokenRouter';
import { registerApiRoutes } from '../apiRoutes';
import { tokenAccessRejection } from '../../auth/tokenAuth';
import { loadSpec, operations, routeParityProblems, tokenAccessProblems } from './openapiSpec';
import type { OpenApiDocument } from './openapiSpec';

function registeredRoutes() {
  const router = createRouter();
  registerApiRoutes(router);
  return router.routes();
}

const rejects = (scope: 'read', method: string, path: string): boolean =>
  tokenAccessRejection(scope, method, path) !== undefined;

describe('docs/openapi.yaml drift', () => {
  const spec = loadSpec();

  it('documents every registered route and has no operation without a route', () => {
    expect(routeParityProblems(registeredRoutes(), spec)).toEqual([]);
  });

  it('flags a route missing from, or extra in, a copy of the spec', () => {
    const copy: OpenApiDocument = structuredClone(spec);
    delete copy.paths['/api/tokens/{tokenId}'].delete;
    copy.paths['/api/ghost'] = { get: { operationId: 'ghost' } };
    const problems = routeParityProblems(registeredRoutes(), copy);
    expect(problems).toContain('registered but not in docs/openapi.yaml: DELETE /api/tokens/{tokenId}');
    expect(problems).toContain('in docs/openapi.yaml but not registered: GET /api/ghost');
  });

  it('treats a renamed path parameter as a mismatch', () => {
    const copy: OpenApiDocument = structuredClone(spec);
    copy.paths['/api/tokens/{id}'] = copy.paths['/api/tokens/{tokenId}'];
    delete copy.paths['/api/tokens/{tokenId}'];
    const problems = routeParityProblems(registeredRoutes(), copy);
    expect(problems).toContain('registered but not in docs/openapi.yaml: DELETE /api/tokens/{tokenId}');
    expect(problems).toContain('in docs/openapi.yaml but not registered: DELETE /api/tokens/{id}');
  });

  it('declares x-token-access matching the token router', () => {
    expect(tokenAccessProblems(createTokenRouter().routes(), spec, rejects)).toEqual([]);
  });

  it('flags wrong or missing x-token-access in a copy of the spec', () => {
    const copy: OpenApiDocument = structuredClone(spec);
    copy.paths['/api/tokens'].get['x-token-access'] = 'read';
    delete copy.paths['/api/tokens'].post['x-token-access'];
    const problems = tokenAccessProblems(createTokenRouter().routes(), copy, rejects);
    expect(problems).toContain('GET /api/tokens: x-token-access is read, expected none');
    expect(problems).toContain('POST /api/tokens: x-token-access must be none, read or write, got undefined');
  });

  it('gives every operation a non-empty string operationId', () => {
    const bad = operations(spec)
      .filter((op) => typeof op.operation.operationId !== 'string' || op.operation.operationId.trim() === '')
      .map((op) => `${op.method} ${op.template}`);
    expect(bad).toEqual([]);
  });

  it('gives every operation a unique operationId', () => {
    const ids = operations(spec).map((op) => op.operation.operationId as string);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
  });

  it('gives every operation at least one tag, all declared at the top level', () => {
    const declaredTags = new Set((spec.tags ?? []).map((tag: { name: string }) => tag.name));
    const badTags = operations(spec)
      .filter((op) => {
        const tags = (op.operation.tags ?? []) as string[];
        return tags.length === 0 || tags.some((tag) => !declaredTags.has(tag));
      })
      .map((op) => `${op.method} ${op.template}`);
    expect(badTags).toEqual([]);
  });
});
