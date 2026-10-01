import { describe, expect, it } from 'vitest';
import type { ComparisonPlan, MonthTargetOutcome, Mover } from '../insights';
import {
  groupSummary, headlineSentences, leftOutNote, netWorthSummary, potSummary, trendSummary,
} from '../insightsText';
import type { PotMonth } from '../types';

const zero = { income: 0, spent: 0, saved: 0, net: 0 };
const slice = { months: ['2026-09'], cap: null };

function plan(over: Partial<ComparisonPlan> = {}): ComparisonPlan {
  return {
    current: slice, previous: slice, leftOut: [], currentLabel: '1–15 Sep', previousLabel: '1–15 Aug', comparable: true, ...over,
  };
}

function mover(name: string, deltaPence: number): Mover {
  return { categoryId: name, name, currentPence: 0, previousPence: 0, deltaPence };
}

function outcome(yearMonth: string, targeted: number, spent: number): MonthTargetOutcome {
  return { yearMonth, targeted, spent };
}

const none = { up: [], down: [] };

describe('headlineSentences', () => {
  it('names the periods compared, in words', () => {
    const sentences = headlineSentences({
      plan: plan(), currentTotals: zero, previousTotals: zero, movers: { up: [], down: [mover('Eating out', -4000)] }, outcomes: [],
    });
    expect(sentences).toEqual(['You spent £40.00 less on Eating out in 1–15 Sep than in 1–15 Aug.']);
  });

  it('puts good news first, and gives at most three sentences', () => {
    const sentences = headlineSentences({
      plan: plan(),
      currentTotals: { ...zero, spent: 50000 },
      previousTotals: { ...zero, spent: 60000 },
      movers: { up: [mover('Fuel', 3000)], down: [mover('Eating out', -4000)] },
      outcomes: [outcome('2026-07', 100, 90), outcome('2026-08', 100, 120)],
    });
    expect(sentences).toHaveLength(3);
    expect(sentences[0]).toContain('less on Eating out');
    expect(sentences[1]).toBe('You finished within your planned spending in 1 of 2 months.');
    expect(sentences[2]).toBe('You spent £100.00 less overall in 1–15 Sep than in 1–15 Aug.');
  });

  it('words an increase plainly, without alarm', () => {
    const [sentence] = headlineSentences({
      plan: plan(), currentTotals: zero, previousTotals: zero, movers: { up: [mover('Fuel', 3000)], down: [] }, outcomes: [],
    });
    expect(sentence).toBe('You spent £30.00 more on Fuel in 1–15 Sep than in 1–15 Aug.');
  });

  it('does not mention target months when none were within target', () => {
    const sentences = headlineSentences({
      plan: plan(), currentTotals: zero, previousTotals: zero, movers: none, outcomes: [outcome('2026-08', 100, 120)],
    });
    expect(sentences).toEqual([]);
  });

  it('never compares a partly tracked period, and says why', () => {
    const sentences = headlineSentences({
      plan: plan({ comparable: false, leftOut: [{ yearMonth: '2026-09', status: 'partly' }] }),
      currentTotals: { ...zero, spent: 500 },
      previousTotals: zero,
      movers: { up: [mover('Fuel', 3000)], down: [] },
      outcomes: [],
    });
    expect(sentences).toEqual([
      'There is nothing to compare yet.',
      'September has too few entries to compare, so it is left out of comparisons.',
    ]);
  });

  it('names several left-out months, and months the user marked', () => {
    const sentences = headlineSentences({
      plan: plan({
        comparable: false,
        leftOut: [
          { yearMonth: '2026-07', status: 'partly' },
          { yearMonth: '2026-08', status: 'partly' },
          { yearMonth: '2026-06', status: 'marked' },
        ],
      }),
      currentTotals: zero, previousTotals: zero, movers: none, outcomes: [],
    });
    expect(sentences).toContain('July and August have too few entries to compare, so they are left out of comparisons.');
    expect(sentences).toContain('June is marked as not tracked, so it is left out of comparisons.');
  });

  it('still reports targets met in finished months when nothing can be compared', () => {
    const sentences = headlineSentences({
      plan: plan({ comparable: false }), currentTotals: zero, previousTotals: zero, movers: none, outcomes: [outcome('2026-07', 100, 100)],
    });
    expect(sentences).toContain('You finished within your planned spending in 1 of 1 month.');
  });
});

describe('leftOutNote', () => {
  it('is null when nothing was left out', () => {
    expect(leftOutNote([])).toBeNull();
  });

  it('lists each reason once, even when a month appears twice', () => {
    const note = leftOutNote([{ yearMonth: '2026-07', status: 'partly' }, { yearMonth: '2026-07', status: 'partly' }]);
    expect(note).toBe('July has too few entries to compare, so it is left out of comparisons.');
  });
});

describe('chart summaries', () => {
  it('says when spending and income peaked', () => {
    const summary = trendSummary([
      { yearMonth: '2026-06', income: 240000, spent: 90000, saved: 0 },
      { yearMonth: '2026-07', income: 200000, spent: 124000, saved: 0 },
    ]);
    expect(summary).toBe('Spending was highest in July 2026 at £1,240.00. Income was highest in June 2026 at £2,400.00.');
  });

  it('says so when nothing was logged', () => {
    expect(trendSummary([{ yearMonth: '2026-06', income: 0, spent: 0, saved: 0 }])).toBe('Nothing was logged in this period.');
  });

  it('names the largest group, with or without a comparison', () => {
    const rows = [
      { group: 'BILLS', label: 'Bills', current: 60000, previous: 50000 },
      { group: 'EVERYDAY', label: 'Everyday Spending', current: 30000, previous: 40000 },
    ];
    expect(groupSummary(rows, 'Apr–Sep 2026')).toBe('Bills was the largest group at £600.00 of £900.00 spent, compared with Apr–Sep 2026.');
    expect(groupSummary(rows, '')).toBe('Bills was the largest group at £600.00 of £900.00 spent.');
  });

  it('describes how a pot moved over the period', () => {
    const months: PotMonth[] = [
      { yearMonth: '2026-07', opening: 10000, setAside: 0, autoAdded: 0, takeOut: 0, spent: 0, closing: 12000 },
      { yearMonth: '2026-08', opening: 12000, setAside: 0, autoAdded: 0, takeOut: 0, spent: 0, closing: 15000 },
    ];
    expect(potSummary('Holidays', months)).toBe('Holidays ended August 2026 at £150.00, up £50.00 from £100.00 at the start.');
    expect(potSummary('Holidays', [{ ...months[0], opening: 12000 }])).toBe('Holidays ended July 2026 at £120.00, unchanged from £120.00 at the start.');
  });

  it('describes net worth and its movement', () => {
    expect(netWorthSummary(400000, 20000)).toBe('Net worth is £4,000.00, up £200.00 over the period.');
    expect(netWorthSummary(-10000, -5000)).toBe('Net worth is −£100.00, down £50.00 over the period.');
    expect(netWorthSummary(0, 0)).toBe('Net worth is £0.00, unchanged over the period.');
  });
});
