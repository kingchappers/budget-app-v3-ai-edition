import { describe, it, expect } from 'vitest';
import { findUnsupportedMarkdown } from '../apiDocs';
import { loadSpec } from '../../../src/api/__tests__/openapiSpec';

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
      findUnsupportedMarkdown(text).map((name) => `${path}: ${name} in ${JSON.stringify(text)}`),
    );
    expect(problems).toEqual([]);
  });
});

describe('findUnsupportedMarkdown', () => {
  it.each([
    ['bold', '**bold**'],
    ['underscore bold', '__x__'],
    ['link', '[a](b)'],
    ['# heading', '# Title'],
    ['### heading', '### Title'],
    ['fenced block', 'Before\n```\ncode\n```'],
    ['table row', '| a | b |'],
    ['raw tag', 'Hello <b>there</b>'],
    ['numbered list', '1. first\n2. second'],
  ])('flags %s', (_name, text) => {
    expect(findUnsupportedMarkdown(text)).not.toEqual([]);
  });

  it('allows ## headings, bullets and code spans, even with markup inside backticks', () => {
    const text = '## Heading\n\n- one with `<b>` and `__Host-x`\n- two\n\nUse `**` carefully.';
    expect(findUnsupportedMarkdown(text)).toEqual([]);
  });
});
