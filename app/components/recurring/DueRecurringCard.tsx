import { useMemo, useState } from 'react';
import { ActionIcon, Alert, Anchor, Button, Card, Group, Menu, Text, ThemeIcon, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconDots, IconPencil } from '@tabler/icons-react';
import { Link } from 'react-router';
import { TOAST_MS, ToastAction } from '~/components/layout/ToastAction';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { useDueRecurring } from '~/hooks/useDueRecurring';
import { useSaveWithUndo } from '~/hooks/useSaveWithUndo';
import { getCategoryIcon } from '~/lib/categoryIcons';
import { currentYearMonth, formatShortDate } from '~/lib/months';
import { useCategories, useSetRecurringHandled } from '~/lib/queries';
import { dueLabel, type DueItem } from '~/lib/recurring';
import { formatSignedPence } from '~/lib/transactionTypes';
import type { Transaction } from '~/lib/types';

function syntheticTransaction(item: DueItem): Transaction {
  const { recurring } = item;
  return {
    transactionId: `recurring-${recurring.recurringId}`,
    yearMonth: item.period,
    amount: recurring.amount,
    type: recurring.type,
    categoryId: recurring.categoryId,
    description: recurring.description,
    date: item.dueDate,
    createdAt: '',
  };
}

export function DueRecurringCard() {
  const { items, isLoading, error, refetch } = useDueRecurring();
  const { data: categories = [] } = useCategories();
  const saveWithUndo = useSaveWithUndo();
  const setHandled = useSetRecurringHandled();
  const [editing, setEditing] = useState<DueItem | null>(null);
  const template = useMemo(() => (editing ? syntheticTransaction(editing) : null), [editing]);

  function labelFor(item: DueItem): string {
    const category = categories.find(c => c.categoryId === item.recurring.categoryId);
    return item.recurring.description || category?.name || 'Recurring item';
  }

  function markHandled(item: DueItem): void {
    setHandled.mutate({ recurringId: item.recurring.recurringId, period: item.period });
  }

  function add(item: DueItem): void {
    const { recurring, dueDate } = item;
    void saveWithUndo({
      amount: recurring.amount,
      type: recurring.type,
      categoryId: recurring.categoryId,
      description: recurring.description,
      date: dueDate,
    });
  }

  function skip(item: DueItem): void {
    const { recurringId } = item.recurring;
    const previousPeriod = item.recurring.handledPeriod;
    markHandled(item);

    const toastId = `skipped-${crypto.randomUUID()}`;
    notifications.show({
      id: toastId,
      autoClose: TOAST_MS,
      message: (
        <ToastAction
          text={`Skipped ${labelFor(item)}`}
          actionLabel="Undo"
          onAction={() => {
            notifications.hide(toastId);
            setHandled.mutate({ recurringId, period: previousPeriod });
          }}
        />
      ),
    });
  }

  let card: React.ReactNode = null;
  if (error) {
    card = (
      <Alert color="danger" title="Could not load recurring items">
        <Button size="compact-sm" onClick={() => refetch()}>Try again</Button>
      </Alert>
    );
  } else if (!isLoading && items.length > 0) {
    card = (
      <Card withBorder>
        <Group justify="space-between" mb="xs">
          <Title order={5}>Due</Title>
          <Anchor component={Link} to="/recurring" size="sm">Manage</Anchor>
        </Group>
        {items.map(item => {
          const Icon = getCategoryIcon(categories.find(c => c.categoryId === item.recurring.categoryId)?.icon ?? 'tag');
          const label = labelFor(item);
          return (
            <Group key={item.recurring.recurringId} justify="space-between" wrap="nowrap" py={4}>
              <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
                <ThemeIcon variant="light" color="primary" radius="xl" size={32}>
                  <Icon size={18} stroke={1.6} />
                </ThemeIcon>
                <div style={{ minWidth: 0 }}>
                  <Text truncate>{label}</Text>
                  <Text size="xs" truncate c={item.status === 'overdue' ? 'danger' : 'dimmed'}>
                    {`${dueLabel(item)} · ${formatShortDate(item.dueDate)}`}
                  </Text>
                </div>
              </Group>
              <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
                <Text fw={500} style={{ whiteSpace: 'nowrap' }}>{formatSignedPence(item.recurring.type, item.recurring.amount)}</Text>
                <Button size="compact-sm" aria-label={`Add ${label}`} onClick={() => add(item)}>Add</Button>
                <Menu position="bottom-end">
                  <Menu.Target>
                    <ActionIcon variant="subtle" aria-label={`More actions for ${label}`}><IconDots size={16} /></ActionIcon>
                  </Menu.Target>
                  <Menu.Dropdown>
                    <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => setEditing(item)}>Edit</Menu.Item>
                    <Menu.Item onClick={() => skip(item)}>Skip</Menu.Item>
                  </Menu.Dropdown>
                </Menu>
              </Group>
            </Group>
          );
        })}
      </Card>
    );
  }

  return (
    <>
      {card}
      <TransactionSheet
        opened={editing !== null}
        onClose={() => setEditing(null)}
        yearMonth={currentYearMonth()}
        template={template}
        templateDate={editing?.dueDate}
        onSaved={() => { if (editing) markHandled(editing); }}
      />
    </>
  );
}
