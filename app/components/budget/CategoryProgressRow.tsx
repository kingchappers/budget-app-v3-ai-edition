import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Group, Progress, Stack, Text, UnstyledButton } from '@mantine/core';
import { formatPence } from '~/lib/money';
import type { CategoryProgress } from '~/lib/summary';

function remainingLabel(spent: number, target: number): string {
  const left = target - spent;
  return left < 0 ? `${formatPence(-left)} over` : `${formatPence(left)} left`;
}

export interface CategoryProgressRowProps {
  progress: CategoryProgress;
  to?: string;
  // How far through the month today is (0 to 100), for the current month only.
  pace?: number | null;
}

export function CategoryProgressRow({ progress, to, pace = null }: CategoryProgressRowProps) {
  const { name, spent, target, period, rawTarget, week } = progress;

  // A weekly target is measured against this week, not the whole month.
  const basisSpent = week ? week.spent : spent;
  const basisTarget = week ? week.target : target;
  const isOver = basisTarget > 0 && basisSpent > basisTarget;
  const percent = basisTarget > 0 ? Math.min(100, Math.round((basisSpent / basisTarget) * 100)) : 0;
  // The bar stops at the end, but the words give the real share, so an overspend is not hidden.
  const spentPercent = basisTarget > 0 ? Math.round((basisSpent / basisTarget) * 100) : 0;
  const showPace = pace !== null && !week;

  const content: ReactNode = (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Text fw={500}>{name}</Text>
        <Text fw={600} c={isOver ? 'attention' : undefined}>
          {remainingLabel(basisSpent, basisTarget)}{week ? ' this week' : ''}
        </Text>
      </Group>
      <div style={{ position: 'relative' }}>
        <Progress value={percent} color={isOver ? 'attention' : 'primary'} aria-label={`${name} progress`} />
        {showPace && (
          <div
            aria-hidden
            data-testid="pace-marker"
            style={{
              position: 'absolute', top: -3, bottom: -3, left: `${pace}%`, width: 2, marginLeft: -1,
              borderRadius: 1, background: 'var(--mantine-color-text)',
            }}
          />
        )}
      </div>
      {showPace && <Text size="sm">Line is today: {pace}% through the month · {spentPercent}% spent</Text>}
      <Text size="sm">
        {week
          ? `${formatPence(week.spent)} of ${formatPence(week.target)} this week`
          : `${formatPence(spent)} spent of ${formatPence(target)}${period === 'WEEKLY' ? ` · ${formatPence(rawTarget)} a week` : ''}`}
      </Text>
    </Stack>
  );

  if (!to) return <div style={{ marginBottom: 'var(--mantine-spacing-sm)' }}>{content}</div>;

  return (
    <UnstyledButton
      component={Link}
      to={to}
      display="block"
      mb="sm"
      style={{ borderRadius: 'var(--mantine-radius-sm)' }}
    >
      {content}
    </UnstyledButton>
  );
}
