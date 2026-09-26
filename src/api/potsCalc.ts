import type { PotAutoEntry, PotMonth, PotSettings, PotSummary, Transaction } from './types';

interface Totals {
  setAside: number;
  takeOut: number;
  spent: number;
}

export interface ComputePotsInput {
  transactions: Transaction[];
  potCategoryIds: string[];
  settings: PotSettings[];
  asOfMonth: string;
}

export function nextMonth(yearMonth: string): string {
  const [year, month] = yearMonth.split('-').map(Number);
  const total = year * 12 + (month - 1) + 1;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, '0')}`;
}

export function autoAmountFor(entries: PotAutoEntry[], yearMonth: string): number {
  let amount = 0;
  for (const entry of entries) {
    if (entry.from <= yearMonth) amount = entry.amount;
  }
  return amount;
}

function monthlyTotals(transactions: Transaction[], categoryId: string, asOfMonth: string): Map<string, Totals> {
  const byMonth = new Map<string, Totals>();
  for (const t of transactions) {
    if (t.categoryId !== categoryId || t.yearMonth > asOfMonth) continue;
    const totals = byMonth.get(t.yearMonth) ?? { setAside: 0, takeOut: 0, spent: 0 };
    if (t.type === 'SET_ASIDE') totals.setAside += t.amount;
    if (t.type === 'TAKE_OUT') totals.takeOut += t.amount;
    if (t.type === 'EXPENSE') totals.spent += t.amount;
    byMonth.set(t.yearMonth, totals);
  }
  return byMonth;
}

function computePot(
  categoryId: string,
  transactions: Transaction[],
  settings: PotSettings | undefined,
  asOfMonth: string,
): PotSummary {
  const entries = [...(settings?.autoContribute ?? [])]
    .filter(entry => entry.from <= asOfMonth)
    .sort((a, b) => a.from.localeCompare(b.from));
  const totalsByMonth = monthlyTotals(transactions, categoryId, asOfMonth);

  const activityMonths = [...totalsByMonth.keys(), ...entries.map(entry => entry.from)];
  const months: PotMonth[] = [];
  let balance = 0;
  if (activityMonths.length > 0) {
    let month = activityMonths.reduce((earliest, m) => (m < earliest ? m : earliest));
    while (month <= asOfMonth) {
      const totals = totalsByMonth.get(month) ?? { setAside: 0, takeOut: 0, spent: 0 };
      const autoAdded = autoAmountFor(entries, month);
      const opening = balance;
      balance = opening + totals.setAside + autoAdded - totals.takeOut - totals.spent;
      months.push({
        yearMonth: month, opening, setAside: totals.setAside, autoAdded,
        takeOut: totals.takeOut, spent: totals.spent, closing: balance,
      });
      month = nextMonth(month);
    }
  }

  const current = months[months.length - 1];
  return {
    categoryId,
    monthlyAmount: settings?.monthlyAmount ?? null,
    goalAmount: settings?.goalAmount ?? null,
    autoAmountNow: autoAmountFor(entries, asOfMonth),
    balance,
    thisMonth: current
      ? { setAside: current.setAside, autoAdded: current.autoAdded, takeOut: current.takeOut, spent: current.spent }
      : { setAside: 0, autoAdded: 0, takeOut: 0, spent: 0 },
    months,
  };
}

export function computePots({ transactions, potCategoryIds, settings, asOfMonth }: ComputePotsInput): PotSummary[] {
  const settingsById = new Map(settings.map(s => [s.categoryId, s]));
  return potCategoryIds.map(categoryId => computePot(categoryId, transactions, settingsById.get(categoryId), asOfMonth));
}
