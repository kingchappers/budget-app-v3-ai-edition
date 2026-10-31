import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { loadSpec, operations } from './openapiSpec';

const REPO_ROOT = resolve(__dirname, '../../..');
const PLUGIN_DIR = resolve(REPO_ROOT, 'plugins/hoardwise');
const SKILL_DIR = resolve(PLUGIN_DIR, 'skills/budget');
// Wording-sensitive assertions live here so a wording edit is a one-line change.
const REVIEW_HEADINGS: Record<string, string> = {
  'review recipe': 'monthly review',
  income: 'income',
  'big spends and deviations': 'unusual',
  tone: 'tone',
  detail: 'detail',
  visuals: 'visuals',
};
const OFFER_DETAIL_HEADING = "offer more detail, don't show it";
const LOOKBACK_PHRASE = /last six months/i;
const RANGE_LIMIT_PHRASE = /at most 24 months/i;
const CONVERT_PHRASE = /dividing by 100/i;
const CURRENCY_WORDS = ['currency', 'pounds'];
const SHOWS_PENCE = /\b(show|display|report|give|print|tell|say|write)\b[^.\n]*\bin pence\b/i;
const DISPLAY_PREFERENCE_TIMING = /never before the first answer/i;
const DISPLAY_PREFERENCE_TRIGGER = /only when a chart, or extra detail, first comes up/i;
const NO_INCOME_ORDER = /give the review first[^\n]*the one question at the end is the income question/i;
const LIKE_FOR_LIKE = /same day of the month/i;
const POT_SPEND_RULE = /counts in the month's spending as well as under the pot/i;
const FORBIDS = /\b(never|don't|do not)\b/i;

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

// Only upper-case methods count; a trailing . , ; : and any ?query are not part of the path.
function mentionedEndpoints(markdown: string): { method: string; path: string }[] {
  const pattern = /\b(GET|HEAD|POST|PUT|PATCH|DELETE)\s+(\/api\/[^\s`)]+)/g;
  return [...markdown.matchAll(pattern)].map((match) => ({
    method: match[1],
    path: match[2].replace(/[.,;:]+$/, '').replace(/\?.*$/, ''),
  }));
}

const normalise = (path: string): string => path.replace(/\{[^}]*\}/g, '{}');

function skillFiles(): string[] {
  return readdirSync(SKILL_DIR, { recursive: true, encoding: 'utf8' }).filter((file) => file.endsWith('.md'));
}

describe('mentionedEndpoints', () => {
  it('ignores trailing punctuation and queries, and only matches upper-case methods', () => {
    const sample = 'Use `GET /api/pots?asOf=2026-10`, then POST /api/transactions. Also HEAD /api/x; PATCH /api/y: and get /api/z.';
    expect(mentionedEndpoints(sample)).toEqual([
      { method: 'GET', path: '/api/pots' },
      { method: 'POST', path: '/api/transactions' },
      { method: 'HEAD', path: '/api/x' },
      { method: 'PATCH', path: '/api/y' },
    ]);
  });
});

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
      .filter((m) => m.method !== 'GET' && m.method !== 'HEAD')
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

describe('token safety', () => {
  const lines = skillFiles().flatMap((file) => readSkillFile(file).split('\n').map((text) => ({ file, text })));
  const forbids = FORBIDS;

  it('never puts a token in a URL', () => {
    expect(lines.filter((l) => /\?token=|access_token=/.test(l.text))).toEqual([]);
  });

  it('never shows curl flags that print request headers', () => {
    const verbose = /\bcurl\b.*(\s--verbose\b|\s--include\b|\s-[A-Za-z]*[vi][A-Za-z]*(\s|$))/;
    expect(lines.filter((l) => verbose.test(l.text))).toEqual([]);
  });

  it('only mentions printing the token in a line that forbids it', () => {
    const printing = /echo\s+"?\$\{?HOARDWISE_TOKEN|printenv\s+HOARDWISE_TOKEN|env\s*\|\s*grep\s+HOARDWISE/;
    expect(lines.filter((l) => printing.test(l.text) && !forbids.test(l.text))).toEqual([]);
  });
});

describe('review guidance', () => {
  const files = skillFiles().map((file) => ({ file, text: readSkillFile(file) }));
  const all = files.map((f) => f.text).join('\n');
  const headings = all.split('\n').filter((line) => /^#{2,3} /.test(line)).map((line) => line.toLowerCase());

  it.each(Object.entries(REVIEW_HEADINGS))('has a heading for %s', (_name, word) => {
    expect(headings.some((heading) => heading.includes(word))).toBe(true);
  });

  it('tells the agent to offer more detail and ask, not show it', () => {
    expect(headings).toContain(`## ${OFFER_DETAIL_HEADING}`);
  });

  it('states the six-month lookback and the 24-month range limit', () => {
    expect(all).toMatch(LOOKBACK_PHRASE);
    expect(all).toMatch(RANGE_LIMIT_PHRASE);
  });

  it('names the calls the review makes', () => {
    const called = files.filter((f) => f.file === 'review.md').flatMap((f) => mentionedEndpoints(f.text)).map((m) => `${m.method} ${m.path}`);
    for (const call of ['GET /api/categories', 'GET /api/transactions/range', 'GET /api/targets', 'GET /api/pots']) {
      expect(called).toContain(call);
    }
  });

  it('converts pence to the user currency and never shows pence', () => {
    expect(all).toMatch(CONVERT_PHRASE);
    for (const word of CURRENCY_WORDS) expect(all).toContain(word);
    const sentences = all.split(/(?<=[.!?])\s+|\n/);
    expect(sentences.filter((sentence) => SHOWS_PENCE.test(sentence) && !FORBIDS.test(sentence))).toEqual([]);
  });

  it('asks about display preference only when a chart or detail first comes up', () => {
    expect(all).toMatch(DISPLAY_PREFERENCE_TIMING);
    expect(all).toMatch(DISPLAY_PREFERENCE_TRIGGER);
  });

  it('gives the review before asking the income question', () => {
    expect(all).toMatch(NO_INCOME_ORDER);
  });

  it('compares a month in progress like for like', () => {
    expect(all).toMatch(LIKE_FOR_LIKE);
    expect(all).not.toMatch(/under your usual month so far/i);
  });

  it('says how Spend in a pot category is counted', () => {
    expect(all).toMatch(POT_SPEND_RULE);
  });

  it('links only to files that exist', () => {
    const broken = files.flatMap(({ file, text }) =>
      [...text.matchAll(/\]\(([^)\s]+)\)/g)]
        .map((match) => match[1].split('#')[0])
        .filter((target) => target !== '' && !/^[a-z]+:/i.test(target))
        .filter((target) => !existsSync(resolve(SKILL_DIR, dirname(file), target)))
        .map((target) => `${file}: ${target}`),
    );
    expect(broken).toEqual([]);
  });

  it('keeps SKILL.md and review.md within 500 lines', () => {
    for (const { text } of files) expect(text.split('\n').length).toBeLessThanOrEqual(500);
  });
});
