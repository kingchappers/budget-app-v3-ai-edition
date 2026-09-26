import { monthIndex } from './months';
import type { Category, CategorySpendTrend, Insights, TopNote, Transaction } from './types';

export const MAX_TOP_NOTES = 8;

export interface ComputeInsightsInput {
  transactions: Transaction[];
  categories: Category[];
  asOfMonth: string;
  months: number;
}

// Mirrors app/lib/noteMemory.ts's normalisation rule. Duplicated rather than
// shared because the API and client are separate build targets (see
// scripts/build-api-handler.cjs) that don't cross-import each other's code.
function normaliseNote(note: string): string {
  return note.trim().toLowerCase().replace(/\s+/g, ' ');
}

function monthFromIndex(index: number): string {
  const year = Math.floor(index / 12);
  const month = index % 12;
  return `${year}-${String(month + 1).padStart(2, '0')}`;
}

function monthWindow(asOfMonth: string, count: number): string[] {
  const endIndex = monthIndex(asOfMonth);
  return Array.from({ length: count }, (_, i) => monthFromIndex(endIndex - count + 1 + i));
}

interface NoteAggregate {
  note: string;
  count: number;
  total: number;
  latestDate: string;
  latestCreatedAt: string;
}

function isNewer(candidate: Transaction, existing: NoteAggregate): boolean {
  if (candidate.date !== existing.latestDate) return candidate.date > existing.latestDate;
  return candidate.createdAt > existing.latestCreatedAt;
}

export function computeInsights({ transactions, categories, asOfMonth, months }: ComputeInsightsInput): Insights {
  const window = monthWindow(asOfMonth, months);
  const windowSet = new Set(window);
  const expenseCategoryIds = categories.filter(c => c.type === 'EXPENSE').map(c => c.categoryId);

  const spendByCategoryMonth = new Map<string, Map<string, number>>();
  const noteAggregates = new Map<string, NoteAggregate>();

  for (const t of transactions) {
    if (t.type !== 'EXPENSE' || !windowSet.has(t.yearMonth)) continue;

    let byMonth = spendByCategoryMonth.get(t.categoryId);
    if (!byMonth) {
      byMonth = new Map();
      spendByCategoryMonth.set(t.categoryId, byMonth);
    }
    byMonth.set(t.yearMonth, (byMonth.get(t.yearMonth) ?? 0) + t.amount);

    const key = normaliseNote(t.description);
    if (key === '') continue;
    const existing = noteAggregates.get(key);
    if (!existing) {
      noteAggregates.set(key, {
        note: t.description.trim(), count: 1, total: t.amount,
        latestDate: t.date, latestCreatedAt: t.createdAt,
      });
    } else {
      existing.count += 1;
      existing.total += t.amount;
      if (isNewer(t, existing)) {
        existing.note = t.description.trim();
        existing.latestDate = t.date;
        existing.latestCreatedAt = t.createdAt;
      }
    }
  }

  const categoryTrends: CategorySpendTrend[] = expenseCategoryIds
    .map((categoryId): CategorySpendTrend => {
      const byMonth = spendByCategoryMonth.get(categoryId);
      const monthsOut = window.map(yearMonth => ({ yearMonth, spent: byMonth?.get(yearMonth) ?? 0 }));
      const total = monthsOut.reduce((sum, m) => sum + m.spent, 0);
      return { categoryId, months: monthsOut, total, average: Math.round(total / months) };
    })
    .sort((a, b) => b.total - a.total);

  const topNotes: TopNote[] = [...noteAggregates.values()]
    .map(({ note, count, total }) => ({ note, count, total }))
    .sort((a, b) => b.total - a.total || b.count - a.count)
    .slice(0, MAX_TOP_NOTES);

  return { months: window, categories: categoryTrends, topNotes };
}
