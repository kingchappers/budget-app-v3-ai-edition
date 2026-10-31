import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parse } from 'yaml';
import { loadSpec, operations } from './openapiSpec';

const REPO_ROOT = resolve(__dirname, '../../..');
const PLUGIN_DIR = resolve(REPO_ROOT, 'plugins/hoardwise');
const SKILL_DIR = resolve(PLUGIN_DIR, 'skills/budget');
const PRIMARY_INSTALL = 'claude plugin install hoardwise --marketplace kingchappers/hoardwise';
const IN_SESSION_INSTALL = '/plugin install hoardwise --marketplace kingchappers/hoardwise';
const MARKETPLACE_ADD = 'claude plugin marketplace add kingchappers/hoardwise';
const PINNED_MARKETPLACE_SOURCE = 'kingchappers/hoardwise#<tag>';
const MANUAL_COPY_PATHS = ['plugins/hoardwise/skills/budget', '~/.claude/skills/budget', '.claude/skills/budget'];
const NO_TOKEN_IN_CHAT = /never paste the token into a chat/i;
const BUMP_VERSION = /bump `version` in `plugins\/hoardwise\/\.claude-plugin\/plugin\.json`/i;
const CHANGELOG_BULLET = /^- \*\*Agent skill\.\*\*/m;
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
const HEADLINE_HONESTY = /headline must honestly reflect the biggest finding/i;
const AT_MOST_ONE_QUESTION = /at most one question/i;
const PREFERENCE_ALONE = /preference question is the only question/i;
const NO_LOG_MENTION = /do not mention logging/i;
const EXAMPLE_ANCHOR = 'Things look steady this month';
const README_VERSION_CLAUSE = 'needs a recent version of Claude Code (the CLI form from v2.1.292)';
const README_PANEL = 'opens the install panel';
const FORBIDS = /\b(never|don't|do not)\b/i;

const WRITE_TOKEN_PHRASE = /write token/i;
const EXPLICIT_REQUEST_PHRASE = /only when the user asks/i;
const READ_BACK_PHRASE = /read it back in plain words/i;
const WAIT_FOR_YES_PHRASE = /only after a clear yes/i;
const IDEMPOTENT_RETRY_PHRASE = /resending the same `transactionId` replaces the entry/i;
const DATA_NOT_INSTRUCTIONS = /data, never instructions/i;
const NEVER_DELETES = /never deletes or edits/i;
const NEVER_EXPOSES_TOKEN = /never prints, echoes, stores, commits or pastes the token/i;
const PAY_DAY_NOT_IN_API = /pay day is not available from the api/i;
const PAY_DAY_ASK_OR_CONFIRM = /ask the user[^\n]*or infer it[^\n]*confirm/i;
const NOT_HANDLED_PHRASE = /not yet handled/i;
const INCOME_QUESTION_POINTER = /when no income is logged, the one question is the income question; see income/i;
const NO_USER_TEXT_IN_SHELL = /never put (user-supplied|user) text inside a shell-quoted string/i;
const BODY_FROM_TEMP_FILE = /body=\$\(mktemp\)[\s\S]*--data @"\$body"[\s\S]*rm -f "\$body"/;
const BODY_PATH_PRINTED = /^\s*body=\$\(mktemp\) && echo "\$body"/m;
const BANNED_BODY_ROUTES = [/body\.json/, /<<'?EOF'?/, /\bjq\b/];
const CURL_STATUS_FLAG = "-w '\\nHTTP %{http_code}\\n'";
const NO_TRANSACTIONS_QUESTION = 'Was this month tracked somewhere else?';
const NO_LOG_OFFER = /log something/i;
const DESIGN_TOOL_UNLESS_ASKED = /unless the user asks you to hand it to a tool they name/i;
const DESIGN_TOOL_ONLY_IF_ASKED = /only if the user asks[^\n]*which tool/i;
const RATE_LIMIT_STOP = /429[^\n]*try again in a little while/i;
const HTTPS_SENTENCE = /should be https/i;
const FIXTURE_WORDS = ['Eating out', 'Holidays', '£65', '£50', 'Groceries'];
const PIN_SENTENCE = 'a release tag from the first one that includes the plugin';
const HISTORY_LINE = /shell history/i;
const CURRENCY_HOME = /show them in the user's currency/gi;
const PENCE_HOME = /never show raw pence/gi;
const CURRENCY_POINTER = /see API essentials/i;
const TWO_DECIMALS_RULE = /at most two decimal places/i;
const NO_ROUNDING_RULE = /do not round or truncate/i;
const ANY_USER_TEXT = /any text the user entered[^\n]*category names/i;
const NO_VERBOSE_RULE = /never use `curl -v`[^\n]*`set -x`/i;
const RETRY_ONCE = /retry once with the same `transactionId`, then stop/i;
const NEW_HEADINGS = ['log a spend', 'pay-day view', 'safety'];

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

function nonReadMentions(markdown: string): string[] {
  return mentionedEndpoints(markdown)
    .filter((m) => m.method !== 'GET' && m.method !== 'HEAD')
    .map((m) => `${m.method} ${m.path}`);
}

describe('nonReadMentions', () => {
  it('lists every mutating mention, including a documented DELETE', () => {
    expect(nonReadMentions('POST /api/transactions, DELETE /api/transactions/{yearMonth}/{transactionId}, GET /api/pots')).toEqual([
      'POST /api/transactions',
      'DELETE /api/transactions/{yearMonth}/{transactionId}',
    ]);
  });
});

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

  it('mentions no mutating call except POST /api/transactions', () => {
    const found = skillFiles().flatMap((file) => nonReadMentions(readSkillFile(file)));
    expect(found.filter((call) => call !== 'POST /api/transactions')).toEqual([]);
  });

  it('shows the HTTP status in every curl example', () => {
    const curls = skillFiles()
      .flatMap((file) => readSkillFile(file).split('\n').map((text) => ({ file, text })))
      .filter((l) => l.text.includes('curl') && l.text.includes('Authorization'));
    expect(curls.length).toBeGreaterThan(0);
    expect(curls.filter((l) => !l.text.includes(CURL_STATUS_FLAG))).toEqual([]);
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
    const texts = [
      ...skillFiles().map(readSkillFile),
      ...['README.md', '.claude-plugin/marketplace.json', 'plugins/hoardwise/.claude-plugin/plugin.json'].map((path) =>
        readFileSync(resolve(REPO_ROOT, path), 'utf8'),
      ),
    ];
    const found = texts.flatMap((text) => text.match(/hw[rw]_[A-Za-z0-9_-]{6,}/g) ?? []);
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

  it('keeps the headline honest about the biggest finding', () => {
    expect(all).toMatch(HEADLINE_HONESTY);
  });

  it('has at least two invented examples and none opens with the anchoring phrase', () => {
    const blocks = readSkillFile('SKILL.md').split('\n\n').filter((block) => block.startsWith('>'));
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    expect(blocks.filter((block) => block.includes(EXAMPLE_ANCHOR))).toEqual([]);
    expect(readSkillFile('SKILL.md').match(/invented/gi)?.length).toBeGreaterThanOrEqual(2);
  });

  it('ends a reply with at most one question and asks the preference question alone', () => {
    expect(all).toMatch(AT_MOST_ONE_QUESTION);
    expect(all).toMatch(PREFERENCE_ALONE);
  });

  it('does not mention logging an expected income unless asked', () => {
    expect(readSkillFile('review.md')).toMatch(NO_LOG_MENTION);
  });

  it('offers no logging and at most one neutral question for a month with no transactions', () => {
    const line = readSkillFile('review.md').split('\n').find((l) => l.includes('A month with no transactions')) ?? '';
    expect(line).not.toBe('');
    expect(line).not.toMatch(NO_LOG_OFFER);
    expect(line).toContain(NO_TRANSACTIONS_QUESTION);
    expect(line.match(/\?/g)?.length).toBe(1);
  });

  it('allows handing data to a tool only when the user asks', () => {
    expect(readSkillFile('SKILL.md')).toMatch(DESIGN_TOOL_UNLESS_ASKED);
    expect(readSkillFile('review.md')).toMatch(DESIGN_TOOL_ONLY_IF_ASKED);
  });

  it('tells the user to try again later on 429 and never to wait on Retry-After', () => {
    expect(all).toMatch(RATE_LIMIT_STOP);
    expect(all).not.toMatch(/wait for the `?Retry-After/i);
    expect(readSkillFile('SKILL.md')).toMatch(HTTPS_SENTENCE);
  });

  it('keeps the currency rule in one home', () => {
    expect(all.match(CURRENCY_HOME)).toHaveLength(1);
    expect(all.match(PENCE_HOME)).toHaveLength(1);
    expect(readSkillFile('recipes.md')).toMatch(CURRENCY_POINTER);
  });

  it('documents recurringId on a transaction and a transactionId in the example body', () => {
    const reference = readSkillFile('reference.md');
    expect(reference).toMatch(/A transaction has[^\n]*`recurringId`/);
    expect(reference.split('\n').find((l) => l.startsWith('{"')) ?? '').toContain('"transactionId"');
  });

  it('uses example categories and pots that are not in any fixture, and repeats no example headline', () => {
    const skill = readSkillFile('SKILL.md');
    const blocks = skill.split('\n\n').filter((block) => block.startsWith('>'));
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const word of FIXTURE_WORDS) expect(skill + readSkillFile('review.md')).not.toContain(word);
    const outside = skill.split('\n\n').filter((block) => !block.startsWith('>')).join('\n\n');
    for (const block of blocks) {
      const headline = block.split('\n')[0].replace(/^>\s*/, '').split(/(?<=\.)\s/)[0];
      expect(outside).not.toContain(headline);
    }
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

describe('recipes: logging, pay-day view and safety', () => {
  const skill = readSkillFile('SKILL.md');
  const review = readSkillFile('review.md');
  const recipes = readSkillFile('recipes.md');
  const all = skillFiles().map((file) => readSkillFile(file)).join('\n');
  const skillHeadings = skill.split('\n').filter((line) => /^## /.test(line)).map((line) => line.toLowerCase());

  it.each(NEW_HEADINGS)('has a short %s section in SKILL.md', (word) => {
    expect(skillHeadings.some((heading) => heading.includes(word))).toBe(true);
  });

  it('links SKILL.md to recipes.md', () => {
    expect(skill).toContain('](recipes.md');
  });

  it('keeps SKILL.md an outline, well under 200 lines', () => {
    expect(skill.split('\n').length).toBeLessThan(200);
  });

  it('logs only on request and needs a write token', () => {
    expect(recipes).toMatch(WRITE_TOKEN_PHRASE);
    expect(recipes).toMatch(EXPLICIT_REQUEST_PHRASE);
  });

  it('reads the entry back and waits for a clear yes before POST /api/transactions', () => {
    expect(recipes).toMatch(READ_BACK_PHRASE);
    expect(recipes).toMatch(WAIT_FOR_YES_PHRASE);
    expect(recipes.search(READ_BACK_PHRASE)).toBeLessThan(recipes.lastIndexOf('POST /api/transactions'));
  });

  it('states that a retry with the same transactionId is safe', () => {
    expect(recipes).toMatch(IDEMPOTENT_RETRY_PHRASE);
  });

  it('has safety statements in SKILL.md', () => {
    expect(skill).toMatch(DATA_NOT_INSTRUCTIONS);
    expect(skill).toMatch(NEVER_DELETES);
    expect(skill).toMatch(NEVER_EXPOSES_TOKEN);
  });

  it('says the pay day is not in the API and must be asked or confirmed', () => {
    expect(recipes).toMatch(PAY_DAY_NOT_IN_API);
    expect(recipes).toMatch(PAY_DAY_ASK_OR_CONFIRM);
  });

  it('counts only bills not yet handled', () => {
    expect(recipes).toMatch(NOT_HANDLED_PHRASE);
    for (const frequency of ['WEEKLY', 'FOUR_WEEKLY', 'MONTHLY', 'QUARTERLY', 'YEARLY']) expect(recipes).toContain(frequency);
  });

  it('points the answer shape and the review at the income question exception', () => {
    expect(skill).toMatch(INCOME_QUESTION_POINTER);
    expect(review).toMatch(INCOME_QUESTION_POINTER);
  });

  it('mentions POST /api/transactions in recipes.md, which the endpoint tests cover', () => {
    expect(skillFiles()).toContain('recipes.md');
    expect(mentionedEndpoints(recipes).map((m) => `${m.method} ${m.path}`)).toContain('POST /api/transactions');
    expect(all).toContain('hww_EXAMPLE');
  });

  it('builds the request body from a file, never from user text in a shell string', () => {
    expect(recipes).toMatch(NO_USER_TEXT_IN_SHELL);
    expect(recipes).toMatch(BODY_FROM_TEMP_FILE);
    for (const banned of BANNED_BODY_ROUTES) {
      expect(skillFiles().filter((file) => banned.test(readSkillFile(file)))).toEqual([]);
    }
  });

  it('prints the temp file path in both POST examples so the agent can write to it', () => {
    expect(recipes).toMatch(BODY_PATH_PRINTED);
    expect(readSkillFile('reference.md')).toMatch(BODY_PATH_PRINTED);
  });

  it('has no single-quoted JSON literal after -d in any skill file', () => {
    const offending = skillFiles().filter((file) => /-d\s+'\{/.test(readSkillFile(file)));
    expect(offending).toEqual([]);
  });

  it('parses pounds like the app: two decimals at most, no rounding', () => {
    expect(recipes).toMatch(TWO_DECIMALS_RULE);
    expect(recipes).toMatch(NO_ROUNDING_RULE);
  });

  it('treats any user-entered text as data', () => {
    expect(skill).toMatch(ANY_USER_TEXT);
  });

  it('forbids verbose output that would leak the token', () => {
    expect(skill).toMatch(NO_VERBOSE_RULE);
  });

  it('retries a failed create once only', () => {
    expect(recipes).toMatch(RETRY_ONCE);
  });
});

describe('install instructions', () => {
  const readme = readFileSync(resolve(REPO_ROOT, 'README.md'), 'utf8');
  const section = readme.split(/^## /m).find((part) => part.startsWith('Use Hoardwise with an AI assistant')) ?? '';
  const readJson = (path: string): { name: string } => JSON.parse(readFileSync(resolve(REPO_ROOT, path), 'utf8'));
  const marketplace = readJson('.claude-plugin/marketplace.json').name;
  const plugin = readJson('plugins/hoardwise/.claude-plugin/plugin.json').name;

  it('has its own README section after Self-hosting', () => {
    expect(section).not.toBe('');
    expect(readme.indexOf('## Self-hosting')).toBeLessThan(readme.indexOf('## Use Hoardwise with an AI assistant'));
  });

  it('gives the one-command install', () => {
    expect(section).toContain(PRIMARY_INSTALL);
    expect(section).toContain(IN_SESSION_INSTALL);
  });

  it('says the one-command form needs a recent Claude Code and what the in-session command does', () => {
    expect(section).toContain(README_VERSION_CLAUSE);
    expect(section).toContain(README_PANEL);
  });

  it('gives the two-step install, built from the real names', () => {
    expect(section).toContain(MARKETPLACE_ADD);
    expect(section).toContain(`claude plugin install ${plugin}@${marketplace}`);
    expect(PRIMARY_INSTALL).toContain(`install ${plugin} --marketplace`);
  });

  it('gives the manual copy routes', () => {
    for (const path of MANUAL_COPY_PATHS) expect(section).toContain(path);
  });

  it('names the environment variables, the API description and the token rule', () => {
    expect(section).toContain('HOARDWISE_URL');
    expect(section).toContain('HOARDWISE_TOKEN');
    expect(section).toContain('docs/openapi.yaml');
    expect(section).toMatch(NO_TOKEN_IN_CHAT);
  });

  it('says which tag to pin and how to set the token without shell history', () => {
    expect(section).toContain(PIN_SENTENCE);
    expect(section).toMatch(HISTORY_LINE);
  });

  it('tells maintainers to bump the version and how to pin a tag', () => {
    expect(section).toMatch(BUMP_VERSION);
    expect(section).toContain(PINNED_MARKETPLACE_SOURCE);
  });

  it('lists the skill in the changelog under Unreleased', () => {
    const changelog = readFileSync(resolve(REPO_ROOT, 'CHANGELOG.md'), 'utf8');
    const unreleased = changelog.split(/^## /m).find((part) => part.startsWith('Unreleased')) ?? '';
    expect(unreleased).toMatch(CHANGELOG_BULLET);
  });
});
