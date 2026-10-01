import type {
  BiggestMovers, ComparisonPlan, GroupBreakdownRow, LeftOut, MonthlyTrendRow, MonthTargetOutcome, Mover, SummaryTotals,
} from './insights';
import { formatMonthLabel, formatMonthName } from './months';
import { formatPence } from './money';
import type { PotMonth } from './types';

const MAX_HEADLINE_SENTENCES = 3;

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function moverSentence(mover: Mover, plan: ComparisonPlan): string {
  const more = mover.deltaPence > 0;
  return `You spent ${formatPence(Math.abs(mover.deltaPence))} ${more ? 'more' : 'less'} on ${mover.name} in ${plan.currentLabel} than in ${plan.previousLabel}.`;
}

function overallSentence(current: SummaryTotals, previous: SummaryTotals, plan: ComparisonPlan): string | null {
  const delta = current.spent - previous.spent;
  if (delta === 0) return null;
  return `You spent ${formatPence(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} overall in ${plan.currentLabel} than in ${plan.previousLabel}.`;
}

function targetSentence(outcomes: MonthTargetOutcome[]): string | null {
  const within = outcomes.filter(outcome => outcome.spent <= outcome.targeted).length;
  if (within === 0) return null;
  return `You finished within your planned spending in ${within} of ${outcomes.length} ${outcomes.length === 1 ? 'month' : 'months'}.`;
}

function leftOutSentences(leftOut: LeftOut[]): string[] {
  const named = (status: LeftOut['status']) => [...new Set(leftOut.filter(item => item.status === status).map(item => item.yearMonth))]
    .map(formatMonthName);
  const partly = named('partly');
  const marked = named('marked');
  const sentences: string[] = [];
  // A long list of months reads as a list of failures, so past two the count is enough.
  if (partly.length > 0 && partly.length <= 2) {
    sentences.push(`${joinNames(partly)} ${partly.length === 1 ? 'has' : 'have'} too few entries to compare, so ${partly.length === 1 ? 'it is' : 'they are'} left out of comparisons.`);
  }
  if (partly.length > 2) {
    sentences.push(`${partly.length} months have too few entries to compare, so they are left out of comparisons.`);
  }
  if (marked.length > 0) {
    sentences.push(`${joinNames(marked)} ${marked.length === 1 ? 'is' : 'are'} marked as not tracked, so ${marked.length === 1 ? 'it is' : 'they are'} left out of comparisons.`);
  }
  return sentences;
}

export interface HeadlineInput {
  plan: ComparisonPlan;
  currentTotals: SummaryTotals;
  previousTotals: SummaryTotals;
  movers: BiggestMovers;
  outcomes: MonthTargetOutcome[];
}

// Up to three plain sentences about what changed, good news first. A period that is
// only partly tracked is never compared; the sentence says so instead.
export function headlineSentences({ plan, currentTotals, previousTotals, movers, outcomes }: HeadlineInput): string[] {
  if (!plan.comparable) {
    return [
      'There is nothing to compare yet.',
      ...leftOutSentences(plan.leftOut),
      targetSentence(outcomes),
    ].filter((sentence): sentence is string => sentence !== null).slice(0, MAX_HEADLINE_SENTENCES);
  }

  const overall = overallSentence(currentTotals, previousTotals, plan);
  const candidates = [
    movers.down[0] ? moverSentence(movers.down[0], plan) : null,
    targetSentence(outcomes),
    overall,
    movers.up[0] ? moverSentence(movers.up[0], plan) : null,
  ];
  return candidates.filter((sentence): sentence is string => sentence !== null).slice(0, MAX_HEADLINE_SENTENCES);
}

// What was left out of the comparison, and why, for the line under the summary.
export function leftOutNote(leftOut: LeftOut[]): string | null {
  const sentences = leftOutSentences(leftOut);
  return sentences.length === 0 ? null : sentences.join(' ');
}

export function trendSummary(rows: MonthlyTrendRow[]): string {
  const top = (pick: (row: MonthlyTrendRow) => number): MonthlyTrendRow | null =>
    rows.reduce<MonthlyTrendRow | null>((best, row) => (pick(row) > (best ? pick(best) : 0) ? row : best), null);
  const spent = top(row => row.spent);
  const income = top(row => row.income);
  const parts = [
    spent ? `Spending was highest in ${formatMonthLabel(spent.yearMonth)} at ${formatPence(spent.spent)}.` : null,
    income ? `Income was highest in ${formatMonthLabel(income.yearMonth)} at ${formatPence(income.income)}.` : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(' ') : 'Nothing was logged in this period.';
}

// previousLabel is empty when there is nothing to compare with.
export function groupSummary(rows: GroupBreakdownRow[], previousLabel: string): string {
  const total = rows.reduce((sum, row) => sum + row.current, 0);
  if (total === 0) return 'Nothing was spent in this period.';
  const largest = rows.reduce((best, row) => (row.current > best.current ? row : best), rows[0]);
  const base = `${largest.label} was the largest group at ${formatPence(largest.current)} of ${formatPence(total)} spent`;
  return previousLabel === '' ? `${base}.` : `${base}, compared with ${previousLabel}.`;
}

export function potSummary(name: string, months: PotMonth[]): string {
  const first = months[0];
  const last = months[months.length - 1];
  const change = last.closing - first.opening;
  const movement = change === 0 ? 'unchanged' : `${change > 0 ? 'up' : 'down'} ${formatPence(Math.abs(change))}`;
  return `${name} ended ${formatMonthLabel(last.yearMonth)} at ${formatPence(last.closing)}, ${movement} from ${formatPence(first.opening)} at the start.`;
}

export function netWorthSummary(current: number, change: number): string {
  const format = (pence: number) => (pence < 0 ? `−${formatPence(-pence)}` : formatPence(pence));
  const movement = change === 0 ? 'unchanged over the period' : `${change > 0 ? 'up' : 'down'} ${formatPence(Math.abs(change))} over the period`;
  return `Net worth is ${format(current)}, ${movement}.`;
}
