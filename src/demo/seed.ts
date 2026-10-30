import { createStore, referenceNow } from '../../scripts/screenshots/fixtures.mjs';
import type { Send } from './api';

type Reader = (path: string, params?: URLSearchParams) => Record<string, unknown>;

const yearMonth = (date: Date): string => date.toISOString().slice(0, 7);

// The fixtures count in UTC fields but the app asks for the visitor's local month, so shift the clock until the UTC fields
// read the local date. Without it the seed lands in the wrong month for the hour either side of local midnight.
const localCalendar = (real: Date): Date => new Date(real.getTime() - real.getTimezoneOffset() * 60_000);

async function must(send: Send, method: string, path: string, body?: unknown): Promise<Record<string, unknown>> {
  const response = await send(method, path, body);
  if (response.status < 200 || response.status >= 300) {
    // The path is a template-free route; the body is never echoed.
    throw new Error(`Demo seed: ${method} ${path.replace(/[0-9a-f-]{36}/g, '{id}')} answered ${response.status}`);
  }
  return JSON.parse(response.body) as Record<string, unknown>;
}

// The fixtures spend on Gifts without ever setting money aside, which would show an overdrawn pot. These rows fund it.
function giftsSetAsides(now: Date): Record<string, unknown>[] {
  const rows: Record<string, unknown>[] = [];
  for (let back = 5; back >= 0; back -= 1) {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 15));
    if (date.getTime() > now.getTime()) continue;
    rows.push({ amount: 4000, type: 'SET_ASIDE', categoryId: 'cat-gifts', description: 'Gifts pot', date: date.toISOString().slice(0, 10) });
  }
  return rows;
}

// Replays the invented household that the About-page screenshots use (scripts/screenshots/fixtures.mjs) as ordinary API
// requests, so the data is valid by construction whenever the data model changes. Nothing here is real.
export async function seedHousehold(send: Send, real: Date = new Date()): Promise<void> {
  // From the 26th the household is dated the 15th (referenceNow): the screenshots rely on that rule, and a bill three
  // days ahead has to stay inside the month, so the demo keeps it rather than forking the fixtures.
  const now = referenceNow(localCalendar(real));
  const fixtures = createStore(now);
  const read: Reader = (path, params = new URLSearchParams()) => fixtures.handle('GET', path, params).json as Record<string, unknown>;
  const month = yearMonth(now);
  const from = yearMonth(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 5, 1)));

  // Bills first: the transactions refer to them, and the handlers choose their ids.
  const recurringIds = new Map<string, string>();
  for (const item of read('/api/recurring').recurring as Record<string, unknown>[]) {
    const created = await must(send, 'POST', '/api/recurring', {
      type: item.type, categoryId: item.categoryId, amount: item.amount, description: item.description,
      dayOfMonth: item.dayOfMonth, frequency: item.frequency, anchorDate: item.anchorDate, leadDays: item.leadDays,
    });
    const newId = (created.recurring as { recurringId: string }).recurringId;
    recurringIds.set(String(item.recurringId), newId);
    if (typeof item.handledPeriod === 'string') {
      await must(send, 'POST', `/api/recurring/${newId}/handled`, { period: item.handledPeriod });
    }
  }

  for (const account of read('/api/accounts').accounts as Record<string, unknown>[]) {
    const created = await must(send, 'POST', '/api/accounts', { name: account.name, kind: account.kind, type: account.type });
    const accountId = (created.account as { accountId: string }).accountId;
    for (const balance of account.balances as { date: string; pence: number }[]) {
      await must(send, 'POST', `/api/accounts/${accountId}/balances`, { date: balance.date, pence: balance.pence });
    }
  }

  for (const target of read('/api/targets').targets as Record<string, unknown>[]) {
    await must(send, 'PUT', `/api/targets/${target.categoryId}`, { targetAmount: target.targetAmount, period: target.period });
  }

  for (const pot of read('/api/pots').pots as Record<string, unknown>[]) {
    await must(send, 'PUT', `/api/pots/${pot.categoryId}`, {
      monthlyAmount: pot.monthlyAmount, goalAmount: pot.goalAmount, autoContribute: false, month,
    });
  }

  const range = new URLSearchParams({ from, to: month });
  const transactions = read('/api/transactions/range', range).transactions as Record<string, unknown>[];
  const rows = [...transactions, ...giftsSetAsides(now)];
  for (const item of rows.slice().sort((a, b) => String(a.date).localeCompare(String(b.date)))) {
    const mapped = typeof item.recurringId === 'string' ? recurringIds.get(item.recurringId) : undefined;
    await must(send, 'POST', '/api/transactions', {
      amount: item.amount, type: item.type, categoryId: item.categoryId, description: item.description, date: item.date,
      ...(mapped ? { recurringId: mapped } : {}),
    });
  }
}
