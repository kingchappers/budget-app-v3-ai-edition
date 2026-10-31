import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { generate, renderAgentDocs } from '../../../scripts/api-docs.mjs';
import { loadSpec, operations } from './openapiSpec';

const ROOT = resolve(__dirname, '../../..');

describe('API docs generator', () => {
  it('is deterministic', () => {
    expect(generate(ROOT)).toEqual(generate(ROOT));
  });

  it('matches the committed generated files', () => {
    for (const { path, content } of generate(ROOT)) {
      const committed = readFileSync(resolve(ROOT, path), 'utf8');
      expect(committed === content, `${path} is stale: run \`yarn docs:generate\``).toBe(true);
    }
  });

  it('mentions every operation', () => {
    const spec = loadSpec();
    const markdown = renderAgentDocs(spec);
    for (const { method, template } of operations(spec)) {
      expect(markdown).toContain(`### ${method} ${template}`);
    }
  });

  it('states the amount, date, type and token rules', () => {
    const markdown = renderAgentDocs(loadSpec());
    for (const word of ['pence', 'YYYY-MM-DD', 'YYYY-MM', 'EXPENSE', 'INCOME', 'SET_ASIDE', 'TAKE_OUT']) {
      expect(markdown).toContain(word);
    }
    expect(markdown).toMatch(/read token/i);
    expect(markdown).toMatch(/read-write token/i);
  });

  it('contains no token value other than the placeholders', () => {
    const found = renderAgentDocs(loadSpec()).match(/hw[rw]_\w+/g) ?? [];
    for (const value of found) expect(['hwr_EXAMPLE', 'hww_EXAMPLE']).toContain(value);
  });

  it('renders a small spec in tag order', () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'Tiny API', version: '1', description: 'Overview text.' },
      tags: [
        { name: 'zebras', description: 'Striped.' },
        { name: 'ants', description: 'Small.' },
      ],
      paths: {
        '/api/ants/{id}': {
          parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
          put: {
            tags: ['ants'],
            summary: 'Rename an ant',
            'x-token-access': 'write',
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { $ref: '#/components/schemas/AntInput' } } },
            },
            responses: { '200': { description: 'Renamed.' }, '404': { description: 'No such ant.' } },
          },
        },
        '/api/zebras': {
          get: {
            tags: ['zebras'],
            summary: 'List zebras',
            'x-token-access': 'read',
            parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer' } }],
            responses: { '200': { description: 'The zebras.' } },
          },
        },
      },
      components: {
        schemas: {
          AntInput: {
            type: 'object',
            required: ['name'],
            properties: { name: { type: 'string', description: 'The new name.' }, legs: { type: 'integer' } },
          },
        },
      },
    };
    const markdown = renderAgentDocs(spec);
    const order = ['# Tiny API', 'Overview text.', '## zebras', '### GET /api/zebras', '## ants', '### PUT /api/ants/{id}'];
    const positions = order.map((text) => markdown.indexOf(text));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(markdown).toContain('Token access: read');
    expect(markdown).toContain('Token access: write');
    expect(markdown).toMatch(/- `limit` \(query, optional\): integer/);
    expect(markdown).toMatch(/- `id` \(path, required\): string/);
    expect(markdown).toMatch(/- `name` \(string, required\): The new name\./);
    expect(markdown).toMatch(/- `legs` \(integer, optional\)/);
    expect(markdown).toMatch(/- 404: No such ant\./);
  });

  it('keeps full response text with balanced code spans on every line', () => {
    const markdown = renderAgentDocs(loadSpec());
    for (const line of markdown.split('\n')) {
      expect((line.match(/`/g) ?? []).length % 2, line).toBe(0);
    }
    expect(markdown).toContain('You can have at most 25 access tokens. Revoke one first.`');
    expect(markdown).toContain(
      "(`type must match the account's existing kind: CASH, SAVINGS, INVESTMENT` for an asset, `... CREDIT_CARD, LOAN` for a liability).",
    );
  });

  it('renders nullable enums and composed schemas with their real types', () => {
    const spec = {
      openapi: '3.1.0',
      info: { title: 'T', version: '1', description: 'D' },
      tags: [{ name: 't' }],
      paths: {
        '/api/x': {
          post: {
            tags: ['t'],
            requestBody: {
              content: { 'application/json': { schema: { $ref: '#/components/schemas/In' } } },
            },
            responses: { '200': { description: 'Ok (see `a. b`). Then more.' } },
          },
        },
      },
      components: {
        schemas: {
          Freq: { type: 'string', enum: ['A', 'B'] },
          In: {
            type: 'object',
            properties: {
              days: { type: ['integer', 'null'], enum: [90, 180, null] },
              freq: { anyOf: [{ $ref: '#/components/schemas/Freq' }, { type: 'null' }] },
              wrapped: { allOf: [{ $ref: '#/components/schemas/Freq' }] },
            },
          },
        },
      },
    };
    const markdown = renderAgentDocs(spec);
    expect(markdown).toContain('`days` (integer|null (90|180|null), optional)');
    expect(markdown).toContain('`freq` (one of: string (A|B), null, optional)');
    expect(markdown).toContain('`wrapped` (string (A|B), optional)');
    expect(markdown).toContain('- 200: Ok (see `a. b`). Then more.');
  });
});
