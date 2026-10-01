import { addDaysIso, daysBetweenIso, lastDayOfMonth, shiftMonth } from './months';
import { frequencyOf, isHandled, nextOccurrences } from './recurring';
import type { Recurring, Transaction } from './types';

export interface BillsBeforePayday {
  payday: string;
  daysToPayday: number;
  total: number;
  count: number;
}

function paydayIn(yearMonth: string, payDay: number): string {
  return `${yearMonth}-${String(Math.min(payDay, lastDayOfMonth(yearMonth))).padStart(2, '0')}`;
}

// The next pay day after today. A pay day of 31 lands on the last day of shorter months.
export function nextPayday(today: string, payDay: number): string {
  const thisMonth = paydayIn(today.slice(0, 7), payDay);
  return thisMonth > today ? thisMonth : paydayIn(shiftMonth(today.slice(0, 7), 1), payDay);
}

// Spending bills that fall due from today until the day before the next pay day, and have not been
// added or skipped yet. Income and bills already dealt with are left out.
export function billsBeforePayday(
  recurring: Recurring[],
  transactions: Transaction[],
  today: string,
  payDay: number,
): BillsBeforePayday {
  const payday = nextPayday(today, payDay);
  const lastDay = addDaysIso(payday, -1);
  let total = 0;
  let count = 0;

  for (const bill of recurring) {
    if (bill.type !== 'EXPENSE') continue;
    for (const date of nextOccurrences(bill, today, lastDay)) {
      const period = frequencyOf(bill) === 'MONTHLY' ? date.slice(0, 7) : date;
      if (isHandled(bill, period, transactions)) continue;
      total += bill.amount;
      count += 1;
    }
  }

  return { payday, daysToPayday: daysBetweenIso(today, payday), total, count };
}
