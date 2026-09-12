import { useState } from 'react';
import { Alert, Button, Divider, Group, Loader, Stack, Text } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { MonthHeader } from '~/components/budget/MonthHeader';
import { TransactionRow } from '~/components/transactions/TransactionRow';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { formatPence } from '~/lib/money';
import { currentYearMonth } from '~/lib/months';
import { useCategories, useDeleteTransaction, useTransactions } from '~/lib/queries';
import type { Transaction } from '~/lib/types';

function TransactionsContent() {
  const [yearMonth, setYearMonth] = useState(currentYearMonth());
  const [editing, setEditing] = useState<Transaction | null>(null);
  const categories = useCategories();
  const transactions = useTransactions(yearMonth);
  const remove = useDeleteTransaction(yearMonth);

  const nameFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.name ?? 'Unknown category';

  const iconFor = (id: string) =>
    categories.data?.find(c => c.categoryId === id)?.icon ?? 'tag';

  if (transactions.error) {
    return (
      <Alert color="red" title="Could not load transactions">
        <Button onClick={() => transactions.refetch()}>Try again</Button>
      </Alert>
    );
  }

  if (transactions.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const items = [...(transactions.data ?? [])].sort((a, b) => (a.date < b.date ? 1 : -1));
  const outgoing = items
    .filter(t => t.type === 'EXPENSE')
    .reduce((sum, t) => sum + t.amount, 0);

  const byDate = items.reduce<Record<string, Transaction[]>>((acc, t) => {
    (acc[t.date] ||= []).push(t);
    return acc;
  }, {});

  return (
    <Stack>
      <MonthHeader yearMonth={yearMonth} onChange={setYearMonth} />
      <Group justify="space-between">
        <Text c="dimmed">{items.length} transactions</Text>
        <Text fw={600}>{formatPence(outgoing)} spent</Text>
      </Group>

      {items.length === 0 && <Text c="dimmed">Nothing logged this month yet.</Text>}

      {Object.entries(byDate).map(([date, dayItems]) => (
        <div key={date}>
          <Divider my="xs" label={date} labelPosition="left" />
          {dayItems.map(t => (
            <TransactionRow
              key={t.transactionId}
              transaction={t}
              categoryName={nameFor(t.categoryId)}
              categoryIcon={iconFor(t.categoryId)}
              onEdit={setEditing}
              onDelete={(item) => remove.mutate(item.transactionId)}
            />
          ))}
        </div>
      ))}

      <TransactionSheet
        opened={editing !== null}
        onClose={() => setEditing(null)}
        yearMonth={yearMonth}
        editing={editing}
      />
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
