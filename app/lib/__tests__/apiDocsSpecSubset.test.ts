import { describe, it, expect } from 'vitest';
import { loadSpec } from '../../../src/api/__tests__/openapiSpec';

const CODE_SPAN = /`[^`\n]*`/g;

const UNSUPPORTED: { name: string; pattern: RegExp }[] = [
  { name: 'bold (**)', pattern: /\*\*/ },
  { name: 'bold (__)', pattern: /__/ },
  { name: 'link [text](url)', pattern: /\[[^\]]*\]\(/ },
  { name: 'heading other than ##', pattern: /^\s{0,3}(#|#{3,6})\s/m },
  { name: 'fenced code block', pattern: /^\s*(```|~~~)/m },
  { name: 'table row', pattern: /^\s*\|.*\|/m },
  { name: 'raw tag', pattern: /<\/?[a-zA-Z][^>]*>/ },
  { name: 'numbered list', pattern: /^\s*\d+[.)]\s/m },
];

function proseStrings(node: unknown, path: string, out: { path: string; text: string }[]): void {
  if (Array.isArray(node)) {
    node.forEach((item, i) => proseStrings(item, `${path}[${i}]`, out));
    return;
  }
  if (node === null || typeof node !== 'object') return;
  for (const [key, value] of Object.entries(node)) {
    const next = `${path}.${key}`;
    if ((key === 'description' || key === 'summary') && typeof value === 'string') {
      out.push({ path: next, text: value });
      continue;
    }
    proseStrings(value, next, out);
  }
}

describe('docs/openapi.yaml prose', () => {
  it('uses only the markdown subset the docs page renders', () => {
    const strings: { path: string; text: string }[] = [];
    proseStrings(loadSpec(), 'spec', strings);
    const problems = strings.flatMap(({ path, text }) =>
      UNSUPPORTED.filter((u) => u.pattern.test(text.replace(CODE_SPAN, ''))).map((u) => `${path}: ${u.name} in ${JSON.stringify(text)}`),
    );
    expect(problems).toEqual([]);
  });
});
