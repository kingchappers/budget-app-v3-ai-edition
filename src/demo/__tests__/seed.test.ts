import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_CATEGORIES } from '../../api/defaults';
import { setStore } from '../../store';
import { createDemoApi } from '../api';
import { createSeededDemoApi } from '../index';
import { seedHousehold } from '../seed';

afterEach(() => setStore(undefined));

const read = async (api: Awaited<ReturnType<typeof createDemoApi>>, path: string): Promise<Record<string, unknown[]>> =>
  JSON.parse((await api.send('GET', path)).body) as Record<string, unknown[]>;

const monthsBack = (count: number): string => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - count, 1)).toISOString().slice(0, 7);
};
const RANGE = `from=${monthsBack(5)}&to=${new Date().toISOString().slice(0, 7)}`;

// The real handler lists every pot category (the defaults too); the household sets up two of them.
async function configuredPots(api: Awaited<ReturnType<typeof createDemoApi>>): Promise<{ balance: number }[]> {
  const pots = (await read(api, `/api/pots?asOf=${new Date().toISOString().slice(0, 7)}`)).pots as { balance: number; monthlyAmount: number | null }[];
  return pots.filter(pot => pot.monthlyAmount !== null);
}

async function counts(api: Awaited<ReturnType<typeof createDemoApi>>): Promise<Record<string, number>> {
  const month = new Date().toISOString().slice(0, 7);
  const [year, mm] = month.split('-');
  return {
    targets: (await read(api, '/api/targets')).targets.length,
    pots: (await configuredPots(api)).length,
    recurring: (await read(api, '/api/recurring')).recurring.length,
    accounts: (await read(api, '/api/accounts')).accounts.length,
    thisMonth: (await read(api, `/api/transactions?year=${year}&month=${Number(mm)}`)).transactions.length,
  };
}

describe('seedHousehold', () => {
  it('fills the invented household through the real handlers', async () => {
    const api = await createDemoApi({ seed: send => seedHousehold(send) });
    const result = await counts(api);
    expect(result.targets).toBe(4);
    expect(result.pots).toBe(2);
    expect(result.recurring).toBe(2);
    expect(result.accounts).toBe(3);
    expect(result.thisMonth).toBeGreaterThan(0);
  });

  it('uses only categories that exist as defaults', async () => {
    const ids = new Set(DEFAULT_CATEGORIES.map(category => category.categoryId));
    const api = await createDemoApi({ seed: send => seedHousehold(send) });
    const transactions = (await read(api, `/api/transactions/range?${RANGE}`)).transactions as { categoryId: string }[];
    expect(transactions.length).toBeGreaterThan(50);
    for (const transaction of transactions) expect(ids.has(transaction.categoryId)).toBe(true);
  });

  it('gives pots a balance that comes from the seeded transactions', async () => {
    const api = await createDemoApi({ seed: send => seedHousehold(send) });
    const pots = await configuredPots(api);
    expect(pots.every(pot => pot.balance > 0)).toBe(true);
  });

  it('links the seeded transactions to the seeded bills and marks them handled', async () => {
    const api = await createDemoApi({ seed: send => seedHousehold(send) });
    const recurring = (await read(api, '/api/recurring')).recurring as { recurringId: string; handledPeriod: string | null }[];
    const ids = new Set(recurring.map(item => item.recurringId));
    const transactions = (await read(api, `/api/transactions/range?${RANGE}`)).transactions as { recurringId?: string }[];
    const linked = transactions.filter(item => item.recurringId !== undefined);
    expect(linked.length).toBeGreaterThan(0);
    for (const item of linked) expect(ids.has(item.recurringId as string)).toBe(true);
    expect(recurring.some(item => item.handledPeriod !== null)).toBe(true);
  });

  it('reset restores the same seeded household after the visitor changes it', async () => {
    const api = await createSeededDemoApi();
    const before = await counts(api);
    const target = (await read(api, '/api/targets')).targets[0] as { categoryId: string };
    await api.send('DELETE', `/api/targets/${target.categoryId}`);
    expect((await counts(api)).targets).toBe(before.targets - 1);
    await api.reset();
    expect(await counts(api)).toEqual(before);
  });
});
