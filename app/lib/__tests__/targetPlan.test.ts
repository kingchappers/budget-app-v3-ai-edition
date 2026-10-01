import { describe, expect, it } from 'vitest';
import { describePlan, planTargets } from '../targetPlan';
import type { CategoryTarget } from '../types';

function target(targetAmount: number, period: CategoryTarget['period']): CategoryTarget {
  return { categoryId: `c${targetAmount}${period}`, targetAmount, period, updatedAt: '' };
}

describe('planTargets', () => {
  it('adds monthly targets as they are', () => {
    const plan = planTargets([target(10000, 'MONTHLY'), target(5000, 'MONTHLY')], 30000, '2026-09');
    expect(plan).toEqual({ planned: 15000, income: 30000, unplanned: 15000 });
  });

  it("turns a weekly target into the month's worth (days over seven)", () => {
    expect(planTargets([target(7000, 'WEEKLY')], 0, '2026-09').planned).toBe(30000);
    expect(planTargets([target(7000, 'WEEKLY')], 0, '2026-02').planned).toBe(28000);
  });

  it('goes negative when the plan is more than income', () => {
    expect(planTargets([target(50000, 'MONTHLY')], 20000, '2026-09').unplanned).toBe(-30000);
  });
});

describe('describePlan', () => {
  it('shows only what is planned when there is no income', () => {
    expect(describePlan({ planned: 184000, income: 0, unplanned: -184000 })).toBe('Planned £1,840.00');
  });

  it('shows what is not yet planned', () => {
    expect(describePlan({ planned: 184000, income: 240000, unplanned: 56000 }))
      .toBe("Planned £1,840.00 of £2,400.00 last month's income · £560.00 not yet planned");
  });

  it('shows the excess without a minus sign', () => {
    expect(describePlan({ planned: 250000, income: 240000, unplanned: -10000 }))
      .toBe("Planned £2,500.00 of £2,400.00 last month's income · £100.00 more than that");
  });
});
