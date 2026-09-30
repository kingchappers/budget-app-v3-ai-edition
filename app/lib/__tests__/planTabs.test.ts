import { describe, expect, it } from 'vitest';
import { isPlanTab, planPath } from '../planTabs';

describe('isPlanTab', () => {
  it('accepts the three tabs and nothing else', () => {
    expect(['targets', 'pots', 'recurring'].every(isPlanTab)).toBe(true);
    expect(isPlanTab('settings')).toBe(false);
    expect(isPlanTab('')).toBe(false);
    expect(isPlanTab(null)).toBe(false);
  });
});

describe('planPath', () => {
  it('leads to the matching tab', () => {
    expect(planPath('targets')).toBe('/plan?tab=targets');
    expect(planPath('recurring', '')).toBe('/plan?tab=recurring');
  });

  it('keeps whatever else was in the address, such as a pot to open', () => {
    expect(planPath('pots', '?pot=holidays&monthly=3000')).toBe('/plan?tab=pots&pot=holidays&monthly=3000');
  });

  it('does not let an old tab parameter override the destination', () => {
    expect(planPath('pots', '?tab=targets&pot=a')).toBe('/plan?tab=pots&pot=a');
  });
});
