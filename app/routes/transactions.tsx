import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { ActionIcon, Divider, Group, Loader, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { LoadError } from '~/components/layout/LoadError';
import { IconSearch, IconX } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { MonthHeader } from '~/components/budget/MonthHeader';
import { TransactionRow } from '~/components/transactions/TransactionRow';
import { useTransactionEditing } from '~/components/transactions/useTransactionEditing';
import { filterTransactions, parseTransactionsParams, UNTARGETED_FILTER, type TransactionFilter } from '~/lib/transactions';
import { categorySelectData } from '~/lib/categoryGroups';
import { formatPence } from '~/lib/money';
import { currentYearMonth, formatDayLabel, formatMonthLabel, monthPhrase, shiftMonth, todayIso } from '~/lib/months';
import { useDocumentTitle } from '~/hooks/useDocumentTitle';
import { useSelectedMonth } from '~/hooks/useSelectedMonth';
import { targetedExpenseCategoryIds } from '~/lib/summary';
import { useCategories, useTargets, useTransactions, useTransactionsRange } from '~/lib/queries';
import type { Transaction, TransactionType } from '~/lib/types';
import { NAMES } from '~/lib/glossary';
import { pageTitle } from '~/lib/pageTitle';
import { TYPE_OPTIONS } from '~/lib/transactionTypes';
import type { Route } from './+types/transactions';

const UNTARGETED_OPTION = { value: UNTARGETED_FILTER, label: NAMES.otherSpendingNoBudget };

// Searching looks back this far, whichever month is on screen.
const SEARCH_MONTHS = 24;

function countLine(count: number, yearMonth: string, searching: boolean): string {
  const noun = count === 1 ? 'transaction' : 'transactions';
  return searching ? `${count} ${noun} found` : `${count} ${noun} ${monthPhrase(yearMonth)}`;
}

function groupBy<T>(items: T[], keyOf: (item: T) => string): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return [...groups];
}

function TransactionsContent() {
  const [searchParams] = useSearchParams();
  const [initial] = useState(() => parseTransactionsParams(searchParams));
  const [yearMonth, setYearMonth] = useSelectedMonth();
  useDocumentTitle(pageTitle('Transactions', formatMonthLabel(yearMonth)));
  const [filter, setFilter] = useState<TransactionFilter>({ query: '', categoryId: initial.categoryId, type: null });
  const categories = useCategories();
  const targets = useTargets();
  const monthTransactions = useTransactions(yearMonth);
  const searching = filter.query.trim() !== '';
  const searchRange = useTransactionsRange(shiftMonth(currentYearMonth(), -(SEARCH_MONTHS - 1)), currentYearMonth(), searching);
  // Searching looks across the last two years; otherwise it's the month on screen.
  const transactions = searching ? searchRange : monthTransactions;
  const { rowActions, sheets } = useTransactionEditing(yearMonth);

  const nameFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.name ?? 'Unknown category';

  const iconFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.icon ?? 'tag';

  if (transactions.error) {
    return (
      <LoadError thing="transactions" onRetry={() => transactions.refetch()} />
    );
  }

  const waitingForTargets = filter.categoryId === UNTARGETED_FILTER && targets.isLoading;
  if (transactions.isLoading || waitingForTargets) return <Group justify="center" py="xl"><Loader /></Group>;

  const all = transactions.data ?? [];
  const targetedIds = targetedExpenseCategoryIds(categories.data ?? [], targets.data ?? []);
  const filtered = filterTransactions(all, categories.data ?? [], filter, targetedIds);
  const items = [...filtered].sort((a, b) => (a.date < b.date ? 1 : -1));
  const outgoing = items
    .filter(t => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + t.amount, 0);

  const today = todayIso();
  const byDate = groupBy(items, t => t.date);
  const byMonth = groupBy(items, t => t.date.slice(0, 7));

  const categoryOptions = [UNTARGETED_OPTION, ...categorySelectData(categories.data ?? [])];
  const isFiltering = filter.query !== '' || filter.categoryId !== null || filter.type !== null;

  return (
    <Stack>
      {searching
        ? <Text size="sm">Searching the last 2 years. Clear the search to go back to {formatMonthLabel(yearMonth)}.</Text>
        : <MonthHeader yearMonth={yearMonth} onChange={setYearMonth} pageTitle="Transactions" />}

      <TextInput
        placeholder="Search transactions"
        aria-label="Search transactions"
        leftSection={<IconSearch size={16} />}
        rightSection={filter.query !== '' && (
          <ActionIcon variant="subtle" aria-label="Clear search" onClick={() => setFilter(f => ({ ...f, query: '' }))}>
            <IconX size={14} />
          </ActionIcon>
        )}
        value={filter.query}
        onChange={e => {
          const query = e.currentTarget.value;
          setFilter(f => ({ ...f, query }));
        }}
      />
      <Group grow>
        <Select
          placeholder="All categories"
          data={categoryOptions}
          value={filter.categoryId}
          onChange={v => setFilter(f => ({ ...f, categoryId: v }))}
          clearable
          aria-label="Filter by category"
        />
        <Select
          placeholder="All types"
          data={TYPE_OPTIONS}
          value={filter.type}
          onChange={v => setFilter(f => ({ ...f, type: v as TransactionType | null }))}
          clearable
          aria-label="Filter by type"
        />
      </Group>

      <Group justify="space-between">
        <Text c="dimmed">{countLine(items.length, yearMonth, searching)}</Text>
        <Text fw={600}>{formatPence(outgoing)} spent</Text>
      </Group>

      {items.length === 0 && all.length === 0 && !searching && <Text c="dimmed">Nothing logged {monthPhrase(yearMonth)}.</Text>}
      {items.length === 0 && all.length > 0 && isFiltering && <Text c="dimmed">No transactions match your search.</Text>}

      {searching
        ? byMonth.map(([month, monthItems]) => (
          <div key={month}>
            <Title order={2} size="h5" mt="md" mb="xs">{formatMonthLabel(month)}</Title>
            {monthItems.map(t => (
              <TransactionRow
                key={t.transactionId}
                transaction={t}
                categoryName={nameFor(t.categoryId)}
                categoryIcon={iconFor(t.categoryId)}
                {...rowActions(t)}
              />
            ))}
          </div>
        ))
        : byDate.map(([date, dayItems]) => (
          <div key={date}>
            <Divider my="xs" label={formatDayLabel(date, today)} labelPosition="left" />
            {dayItems.map(t => (
              <TransactionRow
                key={t.transactionId}
                showDate={false}
                transaction={t}
                categoryName={nameFor(t.categoryId)}
                categoryIcon={iconFor(t.categoryId)}
                {...rowActions(t)}
              />
            ))}
          </div>
        ))}

      {sheets}
    </Stack>
  );
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Transactions') }];

export default function Transactions() {
  return (
    <DefaultLayout>
      <TransactionsContent />
    </DefaultLayout>
  );
}
