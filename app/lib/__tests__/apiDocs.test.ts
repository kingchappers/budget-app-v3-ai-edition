import { describe, it, expect } from 'vitest';
import realSpec from '../../../src/api/generated/openapi.json';
import {
  exampleCurl,
  filterOperations,
  groupOperationsByTag,
  resolveRef,
  schemaFields,
  type ApiSpec,
} from '../apiDocs';

const spec: ApiSpec = {
  tags: [
    { name: 'zeta', description: 'Last alphabetically, first in the spec.' },
    { name: 'alpha' },
  ],
  paths: {
    '/api/things': {
      get: { tags: ['alpha'], summary: 'List things', operationId: 'listThings' },
      post: { tags: ['zeta'], summary: 'Make a thing', operationId: 'makeThing' },
    },
    '/api/things/{id}': {
      delete: { tags: ['zeta'], summary: 'Remove a thing', operationId: 'removeThing' },
    },
  },
  components: {
    schemas: {
      Kind: { type: 'string', enum: ['A', 'B'], description: 'Which kind.' },
      Leaf: { type: 'object', properties: { deep: { type: 'string' } } },
      Mid: { type: 'object', properties: { leaf: { $ref: '#/components/schemas/Leaf' } } },
      Thing: {
        type: 'object',
        required: ['name', 'kind'],
        properties: {
          name: { type: 'string', description: 'The name.' },
          kind: { $ref: '#/components/schemas/Kind' },
          amount: { type: 'integer', description: 'Pence.' },
          tags: { type: 'array', items: { type: 'string' } },
          mids: { type: 'array', items: { $ref: '#/components/schemas/Mid' } },
          either: { anyOf: [{ type: 'string' }, { type: 'integer' }] },
          note: { type: ['string', 'null'] },
        },
      },
    },
  },
};

describe('groupOperationsByTag', () => {
  it('follows the tag order of the spec and lists each operation', () => {
    const groups = groupOperationsByTag(spec);
    expect(groups.map((g) => g.tag)).toEqual(['zeta', 'alpha']);
    expect(groups[0].description).toBe('Last alphabetically, first in the spec.');
    expect(groups[0].operations.map((o) => `${o.method} ${o.path}`)).toEqual([
      'POST /api/things',
      'DELETE /api/things/{id}',
    ]);
    expect(groups[1].operations[0].operation.summary).toBe('List things');
  });

  it('covers every operation of the real spec, with the docs tag present', () => {
    const groups = groupOperationsByTag(realSpec as unknown as ApiSpec);
    expect(groups.map((g) => g.tag)).toContain('docs');
    const count = groups.reduce((n, g) => n + g.operations.length, 0);
    expect(count).toBeGreaterThan(20);
  });
});

describe('resolveRef', () => {
  it('follows a component reference', () => {
    expect(resolveRef(spec, { $ref: '#/components/schemas/Kind' }).enum).toEqual(['A', 'B']);
  });

  it('returns a plain schema unchanged', () => {
    const plain = { type: 'string' };
    expect(resolveRef(spec, plain)).toBe(plain);
  });

  it('throws on an unknown reference', () => {
    expect(() => resolveRef(spec, { $ref: '#/components/schemas/Nope' })).toThrow(/Nope/);
  });
});

describe('schemaFields', () => {
  const fields = schemaFields(spec, { $ref: '#/components/schemas/Thing' });
  const byName = Object.fromEntries(fields.map((f) => [f.name, f]));

  it('marks required and optional fields', () => {
    expect(byName.name.required).toBe(true);
    expect(byName.amount.required).toBe(false);
    expect(byName.name.description).toBe('The name.');
  });

  it('shows enums, arrays and alternatives as short strings', () => {
    expect(byName.kind.type).toBe('one of: A, B');
    expect(byName.tags.type).toBe('array of string');
    expect(byName.either.type).toBe('one of: string, integer');
    expect(byName.note.type).toBe('string or null');
  });

  it('resolves a referenced description when the field has none', () => {
    expect(byName.kind.description).toBe('Which kind.');
  });

  it('nests object fields down to depth 2 and no further', () => {
    const mids = byName.mids;
    expect(mids.type).toBe('array of Mid');
    expect(mids.children?.map((c) => c.name)).toEqual(['leaf']);
    expect(mids.children?.[0].children).toBeUndefined();
  });

  it('honours a smaller depth', () => {
    const shallow = schemaFields(spec, { $ref: '#/components/schemas/Thing' }, 0);
    expect(shallow.every((f) => f.children === undefined)).toBe(true);
  });

  it('describes the real TransactionInput', () => {
    const rows = schemaFields(realSpec as unknown as ApiSpec, { $ref: '#/components/schemas/TransactionInput' });
    const amount = rows.find((r) => r.name === 'amount');
    expect(amount?.required).toBe(true);
    expect(amount?.type).toBe('integer');
    const type = rows.find((r) => r.name === 'type');
    expect(type?.type).toMatch(/^one of: /);
  });
});

describe('exampleCurl', () => {
  it('uses the placeholders and never a literal token', () => {
    const cmd = exampleCurl({ method: 'GET', path: '/api/categories' });
    expect(cmd).toContain('$HOARDWISE_URL/api/categories');
    expect(cmd).toContain('Authorization: Bearer $HOARDWISE_TOKEN');
    expect(cmd).not.toContain('-X');
  });

  it('reads a body from a temporary file instead of a quoted literal', () => {
    const cmd = exampleCurl({ method: 'POST', path: '/api/transactions', body: { amount: 420 } });
    expect(cmd).not.toContain("-d '{");
    expect(cmd).not.toContain('{"amount"');
    expect(cmd).toContain('mktemp');
    expect(cmd).toContain('--data @"$body"');
    expect(cmd).toContain('-X POST');
    expect(cmd).toContain('rm -f "$body"');
  });

  it('quotes a path that contains braces', () => {
    const cmd = exampleCurl({ method: 'DELETE', path: '/api/things/{id}' });
    expect(cmd).toContain('"$HOARDWISE_URL/api/things/{id}"');
  });
});

describe('filterOperations', () => {
  const groups = groupOperationsByTag(spec);

  it('returns everything for an empty query', () => {
    expect(filterOperations(groups, '  ')).toEqual(groups);
  });

  it('matches the path', () => {
    const out = filterOperations(groups, '{id}');
    expect(out).toHaveLength(1);
    expect(out[0].operations.map((o) => o.operation.operationId)).toEqual(['removeThing']);
  });

  it('matches the summary, ignoring case', () => {
    const out = filterOperations(groups, 'MAKE');
    expect(out.flatMap((g) => g.operations.map((o) => o.operation.operationId))).toEqual(['makeThing']);
  });

  it('matches the tag and keeps the whole group', () => {
    const out = filterOperations(groups, 'alpha');
    expect(out.map((g) => g.tag)).toEqual(['alpha']);
    expect(out[0].operations).toHaveLength(1);
  });

  it('drops groups with no match', () => {
    expect(filterOperations(groups, 'nothing-like-this')).toEqual([]);
  });
});
