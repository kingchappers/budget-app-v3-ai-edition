import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { GLOSSARY, NAMES } from '~/lib/glossary';
import { TYPE_OPTIONS } from '~/lib/transactionTypes';

// One word for each idea (PC4). The old words may stay in identifiers, types, API paths and stored
// values, but not in anything a person reads. This reads the source, so a new string that brings one
// back fails here. glossary.ts is where the names live, so it is the one file left out.

const APP = resolve(__dirname, '..');
const OLD_WORDS = /\b(targets?|set aside|take out|expense|reserved)\b/i;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' || name === 'test-utils' || name === '+types' ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && name !== 'glossary.ts' ? [path] : [];
  });
}

// Code inside a template's ${...} is code, not words, so it is emptied before the strings are read.
function withoutComments(source: string): string {
  return source
    .split('\n')
    .filter(line => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
    .replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, '${}');
}

// A string a person could read: it has a space in it, or is a single capitalised word such as 'Targets'.
// A lowercase single token ('targets') is a key or a path, and an upper-case one ('EXPENSE') is a stored value.
function looksLikeProse(text: string): boolean {
  return /\s/.test(text) || /^[A-Z][a-z]+$/.test(text);
}

function readableStrings(source: string): string[] {
  const code = withoutComments(source);
  const literals = [...code.matchAll(/(["'`])((?:\\.|(?!\1)[^\\\n])*)\1/g)].map(match => match[2]);
  // Text between a closing > and the next <. A > that ends an arrow or a type argument is followed by code, not words.
  const jsxText = [...code.matchAll(/(?<![=-])>([^<>{}]+)</g)]
    .map(match => match[1].trim())
    .filter(text => text !== '' && !/[;]|=>|\bconst\b|\breturn\b|\buseState\b/.test(text));
  return [...literals, ...jsxText].filter(looksLikeProse);
}

function offenders(): string[] {
  return sourceFiles(APP).flatMap(file => readableStrings(readFileSync(file, 'utf8'))
    .filter(text => OLD_WORDS.test(text))
    .map(text => `${relative(APP, file)}: ${text}`));
}

describe('one word for each idea', () => {
  it('has none of the old names in anything a person reads', () => {
    expect(offenders()).toEqual([]);
  });

  it('would notice if one came back (the scan itself works)', () => {
    const found = readableStrings('const a = <Text>Targets are optional.</Text>; const b = "Set aside to a pot"; const c = { value: \'EXPENSE\' };');
    expect(found.filter(text => OLD_WORDS.test(text))).toEqual(['Set aside to a pot', 'Targets are optional.']);
  });

  it('ignores code inside a template string\'s ${...}', () => {
    const found = readableStrings('const t = `${formatPence(week.target)} of the total ${period === \'WEEKLY\' ? 1 : 2}`;');
    expect(found.filter(text => OLD_WORDS.test(text))).toEqual([]);
  });

  it('ignores comments, keys, paths and stored values', () => {
    const found = readableStrings('// Targets are optional here\nconst k = [\'targets\']; const p = `/api/targets/${id}`; const t = \'TARGET\';');
    expect(found.filter(text => OLD_WORDS.test(text))).toEqual([]);
  });
});

describe('the glossary names', () => {
  it('uses Add to pot and Take from pot for the two pot movements', () => {
    expect(TYPE_OPTIONS.map(option => option.label)).toEqual(['Spend', 'Income', 'Add to pot', 'Take from pot']);
    expect(GLOSSARY.setAside.term).toBe('Add to pot');
    expect(GLOSSARY.takeOut.term).toBe('Take from pot');
  });

  it('calls a target a budget, in every form', () => {
    expect(GLOSSARY.target.term).toBe('Budget');
    expect(NAMES.budget).toBe('Budget');
    expect(NAMES.budgets).toBe('Budgets');
    expect(NAMES.otherSpendingNoBudget).toBe('Other spending (no budget)');
  });

  it('calls what is saved into pots "Added to pots", and the total "Total in pots"', () => {
    expect(NAMES.addedToPots).toBe('Added to pots');
    expect(NAMES.totalInPots).toBe('Total in pots');
  });

  it('names the pot setting "Pot goal"', () => {
    expect(NAMES.potGoal).toBe('Pot goal');
    expect(GLOSSARY.potGoal.term).toBe('Pot goal');
  });

  it('keeps the spending category type named Spending', () => {
    expect(NAMES.categoryTypeSpending).toBe('Spending');
  });
});
