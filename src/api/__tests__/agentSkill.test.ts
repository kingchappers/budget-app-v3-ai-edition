import { existsSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';

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
