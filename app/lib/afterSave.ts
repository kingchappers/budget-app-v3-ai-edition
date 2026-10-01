import { formatPence } from './money';
import type { Category, CategoryTarget, Transaction } from './types';
import type { TransactionInput } from './api';

// An optional line for the Saved message: what is left in that category's monthly budget now.
// Only for spending in a category with a monthly budget; weekly budgets and everything else say nothing.
// The cached month may not hold the new entry yet, so it is counted here once.
export function leftAfterSaveNote(
  input: TransactionInput,
  categories: Category[],
  targets: CategoryTarget[],
  monthTransactions: Transaction[],
): string | null {
  if (input.type !== 'EXPENSE') return null;
  const target = targets.find(t => t.categoryId === input.categoryId);
  if (!target || target.period !== 'MONTHLY') return null;
  const name = categories.find(c => c.categoryId === input.categoryId)?.name;
  if (!name) return null;

  const month = input.date.slice(0, 7);
  const spentBefore = monthTransactions
    .filter(t => t.type === 'EXPENSE' && t.categoryId === input.categoryId && t.yearMonth === month && t.transactionId !== input.transactionId)
    .reduce((sum, t) => sum + t.amount, 0);
  const left = target.targetAmount - spentBefore - input.amount;
  return left < 0
    ? `${formatPence(-left)} over in ${name} this month.`
    : `${formatPence(left)} left in ${name} this month.`;
}
