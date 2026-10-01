import { describe, expect, it } from 'vitest';
import { isPlanTab, normalisePlanTab, planPath } from '../planTabs';

describe('isPlanTab', () => {
  it('accepts the three tabs and nothing else', () => {
    expect(['budgets', 'pots', 'recurring'].every(isPlanTab)).toBe(true);
    expect(isPlanTab('targets')).toBe(false);
    expect(isPlanTab('settings')).toBe(false);
    expect(isPlanTab('')).toBe(false);
    expect(isPlanTab(null)).toBe(false);
  });
});

describe('planPath', () => {
  it('leads to the matching tab', () => {
    expect(planPath('budgets')).toBe('/plan?tab=budgets');
    expect(planPath('recurring', '')).toBe('/plan?tab=recurring');
  });

  it('keeps whatever else was in the address, such as a pot to open', () => {
    expect(planPath('pots', '?pot=holidays&monthly=3000')).toBe('/plan?tab=pots&pot=holidays&monthly=3000');
  });

  it('does not let an old tab parameter override the destination', () => {
    expect(planPath('pots', '?tab=budgets&pot=a')).toBe('/plan?tab=pots&pot=a');
  });
});

describe('normalisePlanTab', () => {
  it('lets an old link to the targets tab land on budgets', () => {
    expect(normalisePlanTab('targets')).toBe('budgets');
  });

  it('keeps the current tabs and rejects anything else', () => {
    expect(normalisePlanTab('budgets')).toBe('budgets');
    expect(normalisePlanTab('pots')).toBe('pots');
    expect(normalisePlanTab('nonsense')).toBeNull();
    expect(normalisePlanTab(null)).toBeNull();
  });
});
