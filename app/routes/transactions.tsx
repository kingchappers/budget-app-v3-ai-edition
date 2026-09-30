import { useState } from 'react';
import { ActionIcon, Alert, Button, Divider, Group, Loader, Select, Stack, Text, TextInput } from '@mantine/core';
import { IconSearch, IconX } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { MonthHeader } from '~/components/budget/MonthHeader';
import { TransactionRow } from '~/components/transactions/TransactionRow';
import { useTransactionEditing } from '~/components/transactions/useTransactionEditing';
import { filterTransactions, type TransactionFilter } from '~/lib/transactions';
import { categorySelectData } from '~/lib/categoryGroups';
import { formatPence } from '~/lib/money';
import { currentYearMonth } from '~/lib/months';
import { useCategories, useTransactions } from '~/lib/queries';
import type { Transaction, TransactionType } from '~/lib/types';

const TYPE_OPTIONS: { value: TransactionType; label: string }[] = [
  { value: 'EXPENSE', label: 'Expense' },
  { value: 'INCOME', label: 'Income' },
  { value: 'SET_ASIDE', label: 'Set aside' },
  { value: 'TAKE_OUT', label: 'Take out' },
];

function TransactionsContent() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [filter, setFilter] = useState<TransactionFilter>({ query: '', categoryId: null, type: null });
  const categories = useCategories();
  const transactions = useTransactions(yearMonth);
  const { rowActions, sheets } = useTransactionEditing(yearMonth);

  const nameFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.name ?? 'Unknown category';
  const iconFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.icon ?? 'tag';

  if (transactions.error) {
    return (
      <Alert color="danger" title="Could not load transactions">
        <Button onClick={() => transactions.refetch()}>Try again</Button>
      </Alert>
    );
  }

  if (transactions.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const all = transactions.data ?? [];
  const filtered = filterTransactions(all, categories.data ?? [], filter);
  const items = [...filtered].sort((a, b) => (a.date < b.date ? 1 : -1));
  const outgoing = items
    .filter(t => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + t.amount, 0);

  const byDate = items.reduce<Record<string, Transaction[]>>((acc, t) => {
    (acc[t.date] ||= []).push(t);
    return acc;
  }, {});

  const categoryOptions = categorySelectData(categories.data ?? []);
  const isFiltering = filter.query !== '' || filter.categoryId !== null || filter.type !== null;

  return (
    <Stack>
      <MonthHeader yearMonth={yearMonth} onChange={setYearMonth} />

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
        <Text c="dimmed">{items.length} transactions</Text>
        <Text fw={600}>{formatPence(outgoing)} spent</Text>
      </Group>

      {items.length === 0 && all.length === 0 && <Text c="dimmed">Nothing logged this month yet.</Text>}
      {items.length === 0 && all.length > 0 && isFiltering && <Text c="dimmed">No transactions match your search.</Text>}

      {Object.entries(byDate).map(([date, dayItems]) => (
        <div key={date}>
          <Divider my="xs" label={date} labelPosition="left" />
          {dayItems.map(t => (
            <TransactionRow
              key={t.transactionId}
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

export default function Transactions() {
  return (
    <DefaultLayout>
      <TransactionsContent />
    </DefaultLayout>
  );
}
