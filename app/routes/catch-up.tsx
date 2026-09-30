import { useMemo, useState } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Alert, Button, Card, Group, Loader, Stack, Text, TextInput, Title, UnstyledButton } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconCheck } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { TransactionSheet } from '~/components/transactions/TransactionSheet';
import { useDocumentTitle } from '~/hooks/useDocumentTitle';
import { useNothingToLog } from '~/hooks/useNothingToLog';
import { useSaveWithUndo } from '~/hooks/useSaveWithUndo';
import {
  checkLumpSumRange, daysInRange, dayParts, entriesPerDay, recentDays, UNTRACKED_CATEGORY_NAME, untrackedNote,
} from '~/lib/catchUp';
import { parsePounds } from '~/lib/money';
import { currentYearMonth, formatDayLabel, shiftMonth, todayIso } from '~/lib/months';
import { pageTitle } from '~/lib/pageTitle';
import { useCategories, useCreateCategory, useTransactionsRange } from '~/lib/queries';
import { formatSignedPence } from '~/lib/transactionTypes';
import type { Category, Transaction } from '~/lib/types';
import type { Route } from './+types/catch-up';

function dayLabel(day: string, today: string, count: number, nothing: boolean): string {
  const name = formatDayLabel(day, today);
  if (count > 0) return `${name}, ${count} ${count === 1 ? 'entry' : 'entries'}`;
  return nothing ? `${name}, nothing to log` : `${name}, no entries`;
}

interface DayTileProps {
  day: string;
  today: string;
  count: number;
  nothing: boolean;
  onOpen: (day: string) => void;
}

function DayTile({ day, today, count, nothing, onOpen }: DayTileProps) {
  const { weekday, day: dayNumber, month } = dayParts(day);
  return (
    <UnstyledButton
      onClick={() => onOpen(day)}
      aria-label={dayLabel(day, today, count, nothing)}
      style={{
        minWidth: 64, minHeight: 72, padding: 8, textAlign: 'center',
        border: '1px solid var(--mantine-color-default-border)', borderRadius: 'var(--mantine-radius-md)',
      }}
    >
      <Text size="xs" c="dimmed">{weekday}</Text>
      <Text fw={600}>{dayNumber} <Text span size="xs" c="dimmed">{month}</Text></Text>
      <Group gap={4} justify="center" mih={20} aria-hidden>
        {count > 0 && (
          <>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mantine-color-primary-7)' }} />
            <Text size="xs">{count}</Text>
          </>
        )}
        {count === 0 && nothing && <IconCheck size={16} />}
      </Group>
    </UnstyledButton>
  );
}

interface LumpSumProps {
  categories: Category[];
  today: string;
  onSaved: (created: Transaction) => void;
  onCovered: (days: string[]) => void;
}

function LumpSumCard({ categories, today, onSaved, onCovered }: LumpSumProps) {
  const createCategory = useCreateCategory();
  const saveWithUndo = useSaveWithUndo();
  const [amount, setAmount] = useState('');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [errors, setErrors] = useState<{ amount?: string; start?: string; end?: string; form?: string }>({});
  const [busy, setBusy] = useState(false);

  async function untrackedCategoryId(): Promise<string> {
    const existing = categories.find(c => c.type === 'EXPENSE' && c.name.toLowerCase() === UNTRACKED_CATEGORY_NAME.toLowerCase());
    if (existing) return existing.categoryId;
    const created = await createCategory.mutateAsync({ name: UNTRACKED_CATEGORY_NAME, type: 'EXPENSE', icon: 'tag', group: 'EVERYDAY' });
    return created.categoryId;
  }

  async function submit(): Promise<void> {
    const parsed = parsePounds(amount);
    const range = checkLumpSumRange(start, end, today);
    const next: typeof errors = {};
    if (!parsed.ok) next.amount = parsed.message;
    if (!range.ok) next[range.field] = range.message;
    setErrors(next);
    if (!parsed.ok || !range.ok) return;

    setBusy(true);
    try {
      const categoryId = await untrackedCategoryId();
      const created = await saveWithUndo(
        { amount: parsed.pence, type: 'EXPENSE', categoryId, description: untrackedNote(start, end), date: end },
        { categoryName: UNTRACKED_CATEGORY_NAME },
      );
      if (created) {
        onSaved(created);
        onCovered(daysInRange(start, end));
      }
      setAmount('');
      setStart('');
      setEnd('');
    } catch (error) {
      console.error('Catch up: could not save the lump sum', { start, end, error });
      setErrors({ form: 'Could not save. Check your connection and try again.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card withBorder>
      <form onSubmit={event => { event.preventDefault(); void submit(); }}>
        <Stack gap="sm">
          <Title order={5}>Add a lump sum as Untracked</Title>
          <Text size="sm" c="dimmed">
            If the details are gone, add what you think you spent over a stretch of days as one entry. Those days then count as covered.
          </Text>
          <TextInput
            label="Amount"
            placeholder="0.00"
            leftSection="£"
            inputMode="decimal"
            value={amount}
            onChange={event => setAmount(event.currentTarget.value)}
            error={errors.amount}
          />
          <Group grow align="flex-start">
            <DateInput
              label="From"
              valueFormat="DD/MM/YYYY"
              maxDate={today}
              value={start || null}
              onChange={value => setStart(value ?? '')}
              error={errors.start}
            />
            <DateInput
              label="To"
              valueFormat="DD/MM/YYYY"
              maxDate={today}
              value={end || null}
              onChange={value => setEnd(value ?? '')}
              error={errors.end}
            />
          </Group>
          {errors.form && <Text size="sm" role="alert">{errors.form}</Text>}
          <Group justify="flex-end">
            <Button type="submit" loading={busy}>Add lump sum</Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}

function CatchUpContent() {
  const today = todayIso();
  const userSub = useAuth0().user?.sub ?? '';
  const categories = useCategories();
  const nothing = useNothingToLog(userSub);
  const current = currentYearMonth();
  const range = useTransactionsRange(shiftMonth(current, -2), current);
  const days = useMemo(() => recentDays(today), [today]);
  const [openDay, setOpenDay] = useState<string | null>(null);
  const [editing, setEditing] = useState<Transaction | null>(null);
  // Newest first, added during this visit.
  const [justAdded, setJustAdded] = useState<Transaction[]>([]);
  useDocumentTitle(pageTitle('Catch up'));

  if (categories.error || range.error) {
    return (
      <Alert color="danger" title="Could not load your entries">
        <Text size="sm" mb="xs">Nothing has been lost.</Text>
        <Button onClick={() => { categories.refetch(); range.refetch(); }}>Try again</Button>
      </Alert>
    );
  }
  if (categories.isLoading || range.isLoading) return <Group justify="center" py="xl"><Loader /></Group>;

  const transactions = range.data ?? [];
  const counts = entriesPerDay(transactions, days);
  const covered = days.filter(day => (counts.get(day) ?? 0) > 0 || nothing.days.has(day)).length;
  const latest = new Map(transactions.map(t => [t.transactionId, t]));
  const added = [...justAdded]
    .map(t => latest.get(t.transactionId) ?? t)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  function labelFor(t: Transaction): string {
    return t.description || categories.data?.find(c => c.categoryId === t.categoryId)?.name || 'Entry';
  }

  function remember(created: Transaction): void {
    setJustAdded(list => [created, ...list.filter(t => t.transactionId !== created.transactionId)]);
  }

  return (
    <Stack>
      <Title order={3}>Catch up</Title>
      <Text size="sm" c="dimmed">
        Add what you remember for any of the last {days.length} days. Mark a day “Nothing to log” inside it if there was nothing.
        There is no need to do them all.
      </Text>
      {today.slice(8, 10) === '01' && (
        <Text size="sm">It is the 1st of the month, a fresh start. Last month's gaps are still here if you want them.</Text>
      )}
      <Text fw={600}>{covered} of {days.length} days covered</Text>

      <Group gap="xs" role="group" aria-label="Last 31 days">
        {days.map(day => (
          <DayTile key={day} day={day} today={today} count={counts.get(day) ?? 0} nothing={nothing.days.has(day)} onOpen={setOpenDay} />
        ))}
      </Group>

      <LumpSumCard
        categories={categories.data ?? []}
        today={today}
        onSaved={remember}
        onCovered={nothing.mark}
      />

      {added.length > 0 && (
        <Stack gap="xs">
          <Title order={5}>Just added</Title>
          {added.map(t => (
            <Group key={t.transactionId} justify="space-between" wrap="nowrap">
              <div style={{ minWidth: 0 }}>
                <Text truncate>{labelFor(t)}</Text>
                <Text size="xs" c="dimmed">{formatDayLabel(t.date, today)}</Text>
              </div>
              <Group gap="xs" wrap="nowrap">
                <Text fw={500}>{formatSignedPence(t.type, t.amount)}</Text>
                <Button size="compact-sm" variant="subtle" aria-label={`Edit ${labelFor(t)}`} onClick={() => setEditing(t)}>Edit</Button>
              </Group>
            </Group>
          ))}
        </Stack>
      )}

      <TransactionSheet
        opened={openDay !== null}
        onClose={() => setOpenDay(null)}
        yearMonth={current}
        forDate={openDay}
        dayMarkedEmpty={openDay !== null && nothing.days.has(openDay)}
        onToggleNothingToLog={openDay !== null ? () => nothing.toggle(openDay) : undefined}
        onSaved={remember}
        onUndone={() => setJustAdded(list => list.slice(1))}
      />
      <TransactionSheet
        opened={editing !== null}
        onClose={() => setEditing(null)}
        yearMonth={editing?.yearMonth ?? current}
        editing={editing}
      />
    </Stack>
  );
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Catch up') }];

export default function CatchUp() {
  return (
    <DefaultLayout>
      <CatchUpContent />
    </DefaultLayout>
  );
}
