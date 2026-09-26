import { useState } from 'react';
import { Alert, Button, Group, Stack, Switch, Table, Text, TextInput } from '@mantine/core';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { categoryLabel } from '~/lib/categoryIcons';
import { formatPence, formatPencePlain, parsePounds } from '~/lib/money';
import { currentYearMonth, formatMonthLabel } from '~/lib/months';
import { useSavePot } from '~/lib/queries';
import type { Category, PotSummary } from '~/lib/types';
import { PotTrend } from './PotTrend';

export function parseOptionalPounds(
  text: string,
): { ok: true; pence: number | null } | { ok: false; message: string } {
  if (text.trim() === '') return { ok: true, pence: null };
  const parsed = parsePounds(text);
  if (!parsed.ok) return { ok: false, message: parsed.message };
  if (parsed.pence <= 0) return { ok: false, message: 'Enter an amount greater than zero' };
  return { ok: true, pence: parsed.pence };
}

function formatBalance(pence: number): string {
  return pence < 0 ? `−${formatPence(-pence)}` : formatPence(pence);
}

function setAsideCell(setAside: number, autoAdded: number): string {
  const total = formatPence(setAside + autoAdded);
  return autoAdded > 0 ? `${total} (${formatPence(autoAdded)} auto)` : total;
}

function PotSettingsForm({ pot, onClose }: { pot: PotSummary; onClose: () => void }) {
  const save = useSavePot();
  const [monthly, setMonthly] = useState(pot.monthlyAmount !== null ? formatPencePlain(pot.monthlyAmount) : '');
  const [goal, setGoal] = useState(pot.goalAmount !== null ? formatPencePlain(pot.goalAmount) : '');
  const [auto, setAuto] = useState(pot.autoAmountNow > 0);
  const [error, setError] = useState<string | null>(null);

  const parsedMonthly = parseOptionalPounds(monthly);
  const hasMonthly = parsedMonthly.ok && parsedMonthly.pence !== null;

  function submit(event: React.FormEvent): void {
    event.preventDefault();
    const monthlyResult = parseOptionalPounds(monthly);
    const goalResult = parseOptionalPounds(goal);
    if (!monthlyResult.ok) { setError(monthlyResult.message); return; }
    if (!goalResult.ok) { setError(goalResult.message); return; }
    setError(null);
    save.mutate(
      {
        categoryId: pot.categoryId,
        input: {
          monthlyAmount: monthlyResult.pence,
          goalAmount: goalResult.pence,
          autoContribute: auto && monthlyResult.pence !== null,
          month: currentYearMonth(),
        },
      },
      { onSuccess: onClose, onError: () => setError('Could not save. Try again.') },
    );
  }

  return (
    <form onSubmit={submit}>
      <Stack gap="sm">
        <Text fw={600}>Settings</Text>
        <TextInput label="Monthly amount" placeholder="0.00" inputMode="decimal" value={monthly}
          onChange={e => setMonthly(e.currentTarget.value)} />
        <TextInput label="Goal" placeholder="0.00" inputMode="decimal" value={goal}
          onChange={e => setGoal(e.currentTarget.value)} />
        <Switch
          label="Auto-contribute"
          description={hasMonthly ? 'Adds the monthly amount every month, from this month.' : 'Set a monthly amount first.'}
          checked={auto && hasMonthly}
          disabled={!hasMonthly}
          onChange={e => setAuto(e.currentTarget.checked)}
        />
        {error && <Alert color="danger" role="alert">{error}</Alert>}
        <Group justify="flex-end">
          <Button type="submit" loading={save.isPending}>Save</Button>
        </Group>
      </Stack>
    </form>
  );
}

export interface PotHistorySheetProps {
  pot: PotSummary | null;
  category: Category | undefined;
  onClose: () => void;
}

export function PotHistorySheet({ pot, category, onClose }: PotHistorySheetProps) {
  const title = category ? categoryLabel(category) : 'Pot';
  const months = pot ? [...pot.months].reverse() : [];

  return (
    <ResponsiveSheet opened={pot !== null} onClose={onClose} title={title}>
      {pot && (
        <Stack gap="md">
          <div>
            <Text size="xs" c="dimmed">Balance</Text>
            <Text fw={700} size="xl" c={pot.balance < 0 ? 'danger' : undefined}>{formatBalance(pot.balance)}</Text>
          </div>
          <PotTrend values={pot.months.map(m => m.closing)} />
          {months.length === 0 ? (
            <Text c="dimmed" size="sm">No activity yet.</Text>
          ) : (
            <Table.ScrollContainer minWidth={420}>
              <Table>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>Month</Table.Th>
                    <Table.Th>Opening</Table.Th>
                    <Table.Th>Set aside</Table.Th>
                    <Table.Th>Taken out</Table.Th>
                    <Table.Th>Spent</Table.Th>
                    <Table.Th>Closing</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {months.map(m => (
                    <Table.Tr key={m.yearMonth}>
                      <Table.Td>{formatMonthLabel(m.yearMonth)}</Table.Td>
                      <Table.Td>{formatBalance(m.opening)}</Table.Td>
                      <Table.Td>{setAsideCell(m.setAside, m.autoAdded)}</Table.Td>
                      <Table.Td>{formatPence(m.takeOut)}</Table.Td>
                      <Table.Td>{formatPence(m.spent)}</Table.Td>
                      <Table.Td>{formatBalance(m.closing)}</Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          )}
          <PotSettingsForm key={pot.categoryId} pot={pot} onClose={onClose} />
        </Stack>
      )}
    </ResponsiveSheet>
  );
}
