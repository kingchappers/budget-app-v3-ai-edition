import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { loadSpec, operations } from './openapiSpec';

const REPO_ROOT = resolve(__dirname, '../../..');
const PLUGIN_DIR = resolve(REPO_ROOT, 'plugins/hoardwise');
const SKILL_DIR = resolve(PLUGIN_DIR, 'skills/budget');
const PORTABLE_FIELDS = ['name', 'description', 'license', 'compatibility', 'metadata'];

function readSkillFile(name: string): string {
  return readFileSync(resolve(SKILL_DIR, name), 'utf8');
}

function frontMatter(markdown: string): Record<string, unknown> {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(markdown);
  if (!match) throw new Error('Markdown has no leading --- front matter block');
  return parse(match[1]) as Record<string, unknown>;
}

function readJson(path: string): Record<string, any> {
  return JSON.parse(readFileSync(path, 'utf8'));
}

describe('plugin structure', () => {
  const marketplace = readJson(resolve(REPO_ROOT, '.claude-plugin/marketplace.json'));
  const manifest = readJson(resolve(PLUGIN_DIR, '.claude-plugin/plugin.json'));
  const entry = marketplace.plugins?.[0];

  it('has a marketplace with a name, an owner name and one plugin', () => {
    expect(marketplace.name).toBeTruthy();
    expect(marketplace.owner?.name).toBeTruthy();
    expect(marketplace.plugins).toHaveLength(1);
  });

  it('names the marketplace entry after the manifest', () => {
    expect(entry.name).toBe(manifest.name);
  });

  it('uses a relative source without .. that holds the plugin manifest', () => {
    expect(entry.source.startsWith('./')).toBe(true);
    expect(entry.source).not.toContain('..');
    expect(existsSync(resolve(REPO_ROOT, entry.source, '.claude-plugin/plugin.json'))).toBe(true);
  });

  it('keeps the version in the manifest only', () => {
    expect(entry).not.toHaveProperty('version');
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('carries no email in the author and sets a licence', () => {
    expect(manifest.author?.name).toBeTruthy();
    expect(manifest.author).not.toHaveProperty('email');
    expect(manifest.license).toBeTruthy();
  });
});

describe('budget skill', () => {
  const skill = readSkillFile('SKILL.md');
  const meta = frontMatter(skill);

  it('is named after its directory', () => {
    expect(meta.name).toBe('budget');
    expect(meta.name).toBe(basename(SKILL_DIR));
  });

  it('has a description under 1,536 characters', () => {
    expect(typeof meta.description).toBe('string');
    expect((meta.description as string).trim().length).toBeGreaterThan(0);
    expect((meta.description as string).length).toBeLessThan(1536);
  });

  it('uses only portable front matter fields', () => {
    expect(Object.keys(meta).filter((key) => !PORTABLE_FIELDS.includes(key))).toEqual([]);
  });

  it('is at most 500 lines', () => {
    expect(skill.split('\n').length).toBeLessThanOrEqual(500);
  });
});

const SPEC_URL = 'https://github.com/kingchappers/hoardwise/blob/main/docs/openapi.yaml';

function mentionedEndpoints(markdown: string): { method: string; path: string }[] {
  const pattern = /\b(GET|POST|PUT|DELETE)\s+(\/api\/[^\s`)]+)/g;
  return [...markdown.matchAll(pattern)].map((match) => ({ method: match[1], path: match[2] }));
}

const normalise = (path: string): string => path.replace(/\{[^}]*\}/g, '{}');

function skillFiles(): string[] {
  return readdirSync(SKILL_DIR, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.md'));
}

describe('endpoints and facts', () => {
  const spec = operations(loadSpec());
  const findOperation = (method: string, path: string) =>
    spec.find((op) => op.method === method && normalise(op.template) === normalise(path));
  const mentions = skillFiles().flatMap((file) =>
    mentionedEndpoints(readSkillFile(file)).map((mention) => ({ ...mention, file })),
  );

  it('mentions at least one endpoint', () => {
    expect(mentions.length).toBeGreaterThan(0);
  });

  it('only mentions endpoints that exist in the OpenAPI spec', () => {
    const missing = mentions.filter((m) => !findOperation(m.method, m.path)).map((m) => `${m.file}: ${m.method} ${m.path}`);
    expect(missing).toEqual([]);
  });

  it('marks every mentioned write method as needing a write token', () => {
    const notWrite = mentions
      .filter((m) => m.method !== 'GET')
      .filter((m) => findOperation(m.method, m.path)?.operation['x-token-access'] !== 'write')
      .map((m) => `${m.file}: ${m.method} ${m.path}`);
    expect(notWrite).toEqual([]);
  });

  it('states the money, date and type facts in reference.md', () => {
    const reference = readSkillFile('reference.md');
    expect(reference).toMatch(/integer pence/i);
    expect(reference).toContain('YYYY-MM-DD');
    expect(reference).toContain('YYYY-MM`');
    for (const name of ['EXPENSE', 'INCOME', 'SET_ASIDE', 'TAKE_OUT', 'Spend', 'Income', 'Add to pot', 'Take from pot']) {
      expect(reference).toContain(name);
    }
  });

  it('contains no token-looking value except the examples', () => {
    const found = skillFiles().flatMap((file) => readSkillFile(file).match(/hw[rw]_[A-Za-z0-9_-]{6,}/g) ?? []);
    expect(found.filter((value) => value !== 'hwr_EXAMPLE' && value !== 'hww_EXAMPLE')).toEqual([]);
  });

  it('reads the token from the environment on every Authorization line', () => {
    const lines = skillFiles()
      .flatMap((file) => readSkillFile(file).split('\n'))
      .filter((line) => line.includes('Authorization'));
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.filter((line) => !/\$\{?HOARDWISE_TOKEN\}?/.test(line))).toEqual([]);
  });

  it('links SKILL.md to reference.md and the full spec', () => {
    const skill = readSkillFile('SKILL.md');
    expect(skill).toContain('](reference.md)');
    expect(skill).toContain(SPEC_URL);
  });
});
