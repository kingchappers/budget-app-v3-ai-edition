import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CATEGORIES } from '../../api/defaults';
import { setStore } from '../../store';
import { createDemoApi } from '../api';
import { createSeededDemoApi } from '../index';
import { seedHousehold } from '../seed';

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  setStore(undefined);
});

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

  it('leaves no pot overdrawn, and gives Gifts money to spend', async () => {
    const api = await createDemoApi({ seed: send => seedHousehold(send) });
    const pots = (await read(api, `/api/pots?asOf=${new Date().toISOString().slice(0, 7)}`)).pots as { categoryId: string; balance: number }[];
    expect(pots.length).toBeGreaterThan(2);
    for (const pot of pots) expect(pot.balance).toBeGreaterThanOrEqual(0);
    expect(pots.find(pot => pot.categoryId === 'cat-gifts')?.balance).toBeGreaterThan(0);
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

  it("dates the household by the visitor's calendar, so Home is not empty just after local midnight", async () => {
    // 23:30 UTC on 31 October is already 1 November in UTC+1, which is the month the app asks for.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-10-31T23:30:00Z'));
    vi.spyOn(Date.prototype, 'getTimezoneOffset').mockReturnValue(-60);

    const api = await createDemoApi({ seed: send => seedHousehold(send) });

    expect((await read(api, '/api/transactions?year=2026&month=11')).transactions.length).toBeGreaterThan(0);
  });

  // A seed failure means a dead demo, so the edges of the month and the year are pinned.
  it.each([
    ['the 1st of a month', '2026-10-01T12:00:00Z'],
    ['the 15th', '2026-10-15T12:00:00Z'],
    ['the 25th', '2026-10-25T12:00:00Z'],
    ['the 26th', '2026-10-26T12:00:00Z'],
    ['the 31st of a 31-day month', '2026-10-31T12:00:00Z'],
    ['29 February of a leap year', '2028-02-29T12:00:00Z'],
    ['1 January', '2027-01-01T12:00:00Z'],
    ['31 December', '2026-12-31T12:00:00Z'],
  ])('seeds a complete household on %s', async (_label: string, iso: string) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
    const api = await createDemoApi({ seed: send => seedHousehold(send) });
    const result = await counts(api);
    expect(result).toMatchObject({ targets: 4, pots: 2, recurring: 2, accounts: 3 });
    expect(result.thisMonth).toBeGreaterThan(0);
    for (const pot of await configuredPots(api)) expect(pot.balance).toBeGreaterThanOrEqual(0);
  });
});
