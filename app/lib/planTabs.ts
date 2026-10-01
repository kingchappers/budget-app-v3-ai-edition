import { NAMES } from './glossary';

export type PlanTab = 'budgets' | 'pots' | 'recurring';

export const PLAN_TABS: { value: PlanTab; label: string }[] = [
  { value: 'budgets', label: NAMES.budgets },
  { value: 'pots', label: 'Pots' },
  { value: 'recurring', label: 'Recurring' },
];

export function isPlanTab(value: string | null): value is PlanTab {
  return PLAN_TABS.some(tab => tab.value === value);
}

// Budgets were called targets, so an old link to ?tab=targets still lands on them.
export function normalisePlanTab(value: string | null): PlanTab | null {
  if (value === 'targets') return 'budgets';
  return isPlanTab(value) ? value : null;
}

// Where the old /targets, /pots and /recurring addresses now lead. Anything in the
// query string (a pot to open, say) is kept.
export function planPath(tab: PlanTab, search: string = ''): string {
  const rest = search.startsWith('?') ? search.slice(1) : search;
  const params = new URLSearchParams(rest);
  params.delete('tab');
  const others = params.toString();
  return `/plan?tab=${tab}${others === '' ? '' : `&${others}`}`;
}
