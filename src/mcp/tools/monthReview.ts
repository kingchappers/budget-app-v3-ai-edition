import { computePots } from '../../api/potsCalc';
import { loadBudgetWithHistory, shiftMonth } from '../data';
import { buildMonthReview, type MonthReview } from '../review';
import type { McpTool } from '../types';
import { PRIVACY_NOTE, READ_ONLY, monthIsTooFarAhead, monthOf, readMonth } from './shared';

// The month and the six before it.
const MONTHS_BACK = 6;

function guidanceFor(review: MonthReview): string[] {
  const rules = [
    'Lead with how things are going, in plain, calm words.',
    'Mention at most three points, then offer more detail instead of showing it all.',
  ];
  if (review.inProgress) rules.push('This month is still in progress: say "so far" and compare like for like.');
  if (review.dataLevel !== 'ok') rules.push('There is little data yet: say it is early and make few or no claims.');
  if (review.incomeQuestion.ask) rules.push('No income is logged for this month: Ask whether they have been paid this month.');
  rules.push('Use neutral wording such as "went over"; never blame.');
  return rules;
}

export const monthReviewTool: McpTool = {
  name: 'month_review',
  title: 'Month review',
  description:
    "Summarises how a month is going: income, spending against what is usual and any targets, pots, and anything worth mentioning. Defaults to the current month. Read-only.",
  access: 'read',
  inputSchema: {
    type: 'object',
    properties: { month: { type: 'string', description: 'Month as YYYY-MM. Defaults to the current month.' } },
    additionalProperties: false,
  },
  annotations: READ_ONLY,
  async run(args, context) {
    const parsed = readMonth(args.month);
    if (!parsed.ok) return parsed;
    const month = parsed.month ?? monthOf(context.now);
    // The same limit as GET /api/pots?asOf.
    if (monthIsTooFarAhead(month, context.now)) {
      return { ok: false, message: 'month must be at most one month ahead' };
    }

    const budget = await loadBudgetWithHistory(context.userId, { from: shiftMonth(month, -MONTHS_BACK), to: month });
    const pots = computePots({
      transactions: budget.history,
      potCategoryIds: budget.categories.filter((c) => c.type === 'POT').map((c) => c.categoryId),
      settings: budget.settings,
      asOfMonth: month,
    });
    const review = buildMonthReview({
      month,
      now: context.now,
      categories: budget.categories,
      transactions: budget.transactions,
      targets: budget.targets,
      pots,
    });
    return { ok: true, data: { note: PRIVACY_NOTE, ...review, guidance: guidanceFor(review) } };
  },
};
