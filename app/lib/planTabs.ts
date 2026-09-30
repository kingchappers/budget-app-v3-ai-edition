export type PlanTab = 'targets' | 'pots' | 'recurring';

export const PLAN_TABS: { value: PlanTab; label: string }[] = [
  { value: 'targets', label: 'Targets' },
  { value: 'pots', label: 'Pots' },
  { value: 'recurring', label: 'Recurring' },
];

export function isPlanTab(value: string | null): value is PlanTab {
  return PLAN_TABS.some(tab => tab.value === value);
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
