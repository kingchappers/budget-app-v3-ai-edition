import { useRef, useState } from 'react';
import { ActionIcon, Alert, Button, Group, Stack, Switch, Table, Text, TextInput, UnstyledButton } from '@mantine/core';
import { IconPencil } from '@tabler/icons-react';
import { ResponsiveSheet } from '~/components/layout/ResponsiveSheet';
import { categoryLabel } from '~/lib/categoryIcons';
import { formatPence, formatPencePlain, parsePounds } from '~/lib/money';
import { currentYearMonth, formatMonthLabel } from '~/lib/months';
import { useSavePot, useUpdateCategory } from '~/lib/queries';
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

function PotSettingsForm({ pot, category, onClose }: { pot: PotSummary; category: Category | undefined; onClose: () => void }) {
  const save = useSavePot();
  const updateCategory = useUpdateCategory();
  const [monthly, setMonthly] = useState(pot.monthlyAmount !== null ? formatPencePlain(pot.monthlyAmount) : '');
  const [goal, setGoal] = useState(pot.goalAmount !== null ? formatPencePlain(pot.goalAmount) : '');
  const [auto, setAuto] = useState(pot.autoAmountNow > 0);
  const [error, setError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState(category?.name ?? '');
  // Committing on Enter triggers a blur (input unmounts on the next render,
  // which fires synchronously before React re-renders) — this guards against
  // that blur re-running the same commit a second time.
  const renameCommittedRef = useRef(false);

  const parsedMonthly = parseOptionalPounds(monthly);
  const hasMonthly = parsedMonthly.ok && parsedMonthly.pence !== null;

  function startRename(): void {
    if (!category) return;
    renameCommittedRef.current = false;
    setNameDraft(category.name);
    setRenaming(true);
  }

  function cancelRename(): void {
    renameCommittedRef.current = true;
    setRenaming(false);
  }

  function commitRename(): void {
    if (renameCommittedRef.current || !category) return;
    renameCommittedRef.current = true;
    setRenaming(false);

    const trimmed = nameDraft.trim();
    if (trimmed === category.name) return;
    if (trimmed.length === 0 || trimmed.length > 50) {
      setError('Enter a name from 1 to 50 characters');
      return;
    }
    updateCategory.mutate(
      { categoryId: category.categoryId, name: trimmed },
      { onError: () => setError('Could not rename. Try again.') },
    );
  }

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
        {category && !category.isDefault && (
          renaming ? (
            <TextInput
              size="xs"
              autoFocus
              aria-label={`Rename ${category.name}`}
              value={nameDraft}
              onChange={e => setNameDraft(e.currentTarget.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
                if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
              }}
            />
          ) : (
            <Group gap={4}>
              <UnstyledButton onClick={startRename}>
                <Text size="sm" c="dimmed">{categoryLabel(category)}</Text>
              </UnstyledButton>
              <ActionIcon size="xs" variant="subtle" aria-label={`Rename ${category.name}`} onClick={startRename}>
                <IconPencil size={12} />
              </ActionIcon>
            </Group>
          )
        )}
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
          <PotSettingsForm key={pot.categoryId} pot={pot} category={category} onClose={onClose} />
        </Stack>
      )}
    </ResponsiveSheet>
  );
}
