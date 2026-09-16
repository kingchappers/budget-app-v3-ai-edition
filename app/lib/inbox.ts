import type { InboxItem } from './types';

export function groupByBookingDate(items: InboxItem[]): { date: string; items: InboxItem[] }[] {
  const groups: { date: string; items: InboxItem[] }[] = [];
  for (const item of items) {
    const last = groups.at(-1);
    if (last && last.date === item.bookingDate) last.items.push(item);
    else groups.push({ date: item.bookingDate, items: [item] });
  }
  return groups;
}
