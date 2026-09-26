import { formatPence } from './money';
import type { PotSummary } from './types';

export function goalPercent(balance: number, goal: number | null): number | null {
  if (goal === null || goal <= 0) return null;
  return Math.max(0, Math.min(100, Math.round((balance / goal) * 100)));
}

export function thisMonthSummary(pot: PotSummary): string | null {
  const { setAside, autoAdded, takeOut, spent } = pot.thisMonth;
  const parts: string[] = [];
  if (setAside + autoAdded > 0) parts.push(`+${formatPence(setAside + autoAdded)} set aside`);
  if (takeOut > 0) parts.push(`−${formatPence(takeOut)} taken out`);
  if (spent > 0) parts.push(`−${formatPence(spent)} spent`);
  return parts.length > 0 ? parts.join(' · ') : null;
}
