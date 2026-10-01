import { useMemo, useRef, useState } from 'react';
import { ActionIcon, Alert, Anchor, Button, Card, Divider, Group, Menu, Stack, Text, ThemeIcon, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconBellPause, IconDots, IconPencil, IconPlayerSkipForward } from '@tabler/icons-react';
import { useAuth0 } from '@auth0/auth0-react';
import { Link } from 'react-router';
import { TOAST_MS, ToastAction } from '~/components/layout/ToastAction';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { useDueRecurring } from '~/hooks/useDueRecurring';
import { useSaveWithUndo } from '~/hooks/useSaveWithUndo';
import { CategoryIcon } from '~/components/categories/CategoryIcon';
import { dismissMatch, isMatchDismissed, isSnoozed, snoozeUntilTomorrow } from '~/lib/billPrefs';
import { currentYearMonth, formatMonthName, formatShortDate, todayIso } from '~/lib/months';
import { usePreferences } from '~/lib/preferences';
import { useCategories, useLinkTransaction, useSetRecurringHandled } from '~/lib/queries';
import { undoAutoClose } from '~/lib/undoDuration';
import { dueLabel, groupDueItems, olderGroupHeading, type DueGroup, type DueItem } from '~/lib/recurring';
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

interface DueRowProps {
  item: DueItem;
  label: string;
  icon: string;
  match: Transaction | null;
  onAdd: (item: DueItem) => void;
  onEdit: (item: DueItem) => void;
  onSkip: (item: DueItem) => void;
  onSnooze: (item: DueItem) => void;
  onConfirmMatch: (item: DueItem, match: Transaction) => void;
  onRejectMatch: (item: DueItem, match: Transaction) => void;
}

function DueRow({ item, label, icon, match, onAdd, onEdit, onSkip, onSnooze, onConfirmMatch, onRejectMatch }: DueRowProps) {
  return (
    <Stack gap={4} py={4}>
      <Group justify="space-between" wrap="nowrap">
        <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
          <ThemeIcon variant="light" color="primary" radius="xl" size={32}>
            <CategoryIcon icon={icon} />
          </ThemeIcon>
          <div style={{ minWidth: 0 }}>
            <Text truncate>{label}</Text>
            <Text size="sm">{dueLabel(item)}</Text>
          </div>
        </Group>
        <Group gap="xs" wrap="nowrap" style={{ flexShrink: 0 }}>
          <Text fw={500} style={{ whiteSpace: 'nowrap' }}>{formatSignedPence(item.recurring.type, item.recurring.amount)}</Text>
          <Button size="compact-sm" aria-label={`Add ${label}`} onClick={() => onAdd(item)}>Add</Button>
          <Menu position="bottom-end">
            <Menu.Target>
              <ActionIcon variant="subtle" aria-label={`More actions for ${label}`}><IconDots size={16} /></ActionIcon>
            </Menu.Target>
            <Menu.Dropdown>
              <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => onEdit(item)}>Add with changes</Menu.Item>
              <Menu.Item leftSection={<IconPlayerSkipForward size={14} />} onClick={() => onSkip(item)}>Didn't happen</Menu.Item>
              <Menu.Item leftSection={<IconBellPause size={14} />} onClick={() => onSnooze(item)}>Remind me tomorrow</Menu.Item>
            </Menu.Dropdown>
          </Menu>
        </Group>
      </Group>
      {match && (
        <Group role="group" aria-label={`Possible match for ${label}`} gap="xs" pl={44} wrap="wrap">
          <Text size="sm">{`Looks like you logged this on ${formatShortDate(match.date)}. Same thing?`}</Text>
          <Group gap="xs" wrap="nowrap">
            <Button size="compact-sm" variant="light" onClick={() => onConfirmMatch(item, match)}>Yes, that's it</Button>
            <Button size="compact-sm" variant="subtle" onClick={() => onRejectMatch(item, match)}>No</Button>
          </Group>
        </Group>
      )}
    </Stack>
  );
}

export function DueRecurringCard() {
  const { items, isLoading, error, refetch } = useDueRecurring();
  const { data: categories = [] } = useCategories();
  const userSub = useAuth0().user?.sub ?? '';
  const [{ undoDuration }] = usePreferences();
  const saveWithUndo = useSaveWithUndo();
  const setHandled = useSetRecurringHandled();
  const link = useLinkTransaction();
  const addingRef = useRef<Set<string>>(new Set());
  const [editing, setEditing] = useState<DueItem | null>(null);
  const [, setPrefsVersion] = useState(0);
  const template = useMemo(() => (editing ? syntheticTransaction(editing) : null), [editing]);
  const today = todayIso();

  const visible = items.filter(item => !isSnoozed(userSub, item.recurring.recurringId, item.period, today));
  const groups = groupDueItems(visible, today);

  function labelFor(item: DueItem): string {
    const category = categories.find(c => c.categoryId === item.recurring.categoryId);
    return item.recurring.description || category?.name || 'Recurring item';
  }

  function openMatch(item: DueItem): Transaction | null {
    const { recurringId } = item.recurring;
    return item.likelyMatches.find(t => !isMatchDismissed(userSub, recurringId, t.transactionId)) ?? null;
  }

  function markHandled(item: DueItem): void {
    setHandled.mutate({ recurringId: item.recurring.recurringId, period: item.period });
  }

  function add(item: DueItem): void {
    const { recurring, dueDate } = item;
    const inFlight = addingRef.current;
    if (inFlight.has(recurring.recurringId)) return;
    inFlight.add(recurring.recurringId);
    void saveWithUndo({
      amount: recurring.amount,
      type: recurring.type,
      categoryId: recurring.categoryId,
      description: recurring.description,
      date: dueDate,
      recurringId: recurring.recurringId,
    }).finally(() => { inFlight.delete(recurring.recurringId); });
  }

  function addAll(group: DueGroup): void {
    group.items.forEach(add);
  }

  function skip(item: DueItem): void {
    const { recurringId } = item.recurring;
    const previousPeriod = item.recurring.handledPeriod;
    markHandled(item);

    const toastId = `skipped-${crypto.randomUUID()}`;
    notifications.show({
      id: toastId,
      autoClose: undoAutoClose(undoDuration),
      withCloseButton: true,
      closeButtonProps: { 'aria-label': 'Close notification' },
      message: (
        <ToastAction
          text={`Skipped ${labelFor(item)} for ${formatMonthName(item.period)}`}
          actionLabel="Undo"
          onAction={() => {
            notifications.hide(toastId);
            setHandled.mutate({ recurringId, period: previousPeriod });
          }}
        />
      ),
    });
  }

  function snooze(item: DueItem): void {
    snoozeUntilTomorrow(userSub, item.recurring.recurringId, item.period, today);
    setPrefsVersion(version => version + 1);
    notifications.show({ autoClose: TOAST_MS, message: `${labelFor(item)} will show again tomorrow` });
  }

  function confirmMatch(item: DueItem, match: Transaction): void {
    link.mutate({ transaction: match, recurringId: item.recurring.recurringId }, {
      onError: (linkError) => {
        console.error('Failed to link a transaction to its recurring bill:', linkError);
        notifications.show({
          autoClose: TOAST_MS,
          message: `Couldn't record ${labelFor(item)} as logged. Check your connection and try again.`,
        });
      },
    });
  }

  function rejectMatch(item: DueItem, match: Transaction): void {
    dismissMatch(userSub, item.recurring.recurringId, match.transactionId);
    setPrefsVersion(version => version + 1);
  }

  function renderRow(item: DueItem): React.ReactNode {
    return (
      <DueRow
        key={item.recurring.recurringId}
        item={item}
        label={labelFor(item)}
        icon={categories.find(c => c.categoryId === item.recurring.categoryId)?.icon ?? 'tag'}
        match={openMatch(item)}
        onAdd={add}
        onEdit={setEditing}
        onSkip={skip}
        onSnooze={snooze}
        onConfirmMatch={confirmMatch}
        onRejectMatch={rejectMatch}
      />
    );
  }

  let card: React.ReactNode = null;
  if (error) {
    card = (
      <Alert color="danger" title="Could not load recurring items">
        <Button size="compact-sm" onClick={() => refetch()}>Try again</Button>
      </Alert>
    );
  } else if (!isLoading && visible.length > 0) {
    card = (
      <Card withBorder>
        <Group justify="space-between" mb="xs">
          <Title order={5}>Due</Title>
          <Anchor component={Link} to="/plan?tab=recurring" size="sm">Manage</Anchor>
        </Group>
        {groups.current.map(renderRow)}
        {groups.older.map((group, index) => (
          <section key={group.period} aria-label={olderGroupHeading(group.period)}>
            {(index > 0 || groups.current.length > 0) && <Divider my="xs" />}
            <Group justify="space-between" wrap="nowrap" mb={4}>
              <Title order={6}>{olderGroupHeading(group.period)}</Title>
              <Button
                size="compact-sm"
                variant="light"
                aria-label={`Add all from ${formatMonthName(group.period)}`}
                onClick={() => addAll(group)}
              >
                Add all
              </Button>
            </Group>
            {group.items.map(renderRow)}
          </section>
        ))}
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
        recurringId={editing?.recurring.recurringId}
        onSaved={() => { if (editing) markHandled(editing); }}
        onUndone={() => {
          if (!editing) return;
          setHandled.mutate({
            recurringId: editing.recurring.recurringId,
            period: editing.recurring.handledPeriod,
          });
        }}
      />
    </>
  );
}
