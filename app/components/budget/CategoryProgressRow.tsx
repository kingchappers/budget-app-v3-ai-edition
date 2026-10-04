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
  // Names the pace line above the bar. Shown once per section, not on every row.
  paceCaption?: boolean;
}

function PaceCaption({ pace }: { pace: number }) {
  const align = pace < 20 ? 'left' : pace > 80 ? 'right' : 'centre';
  const transform = { left: 'none', right: 'translateX(-100%)', centre: 'translateX(-50%)' }[align];
  return (
    <div aria-hidden style={{ position: 'relative', height: '1.25rem' }}>
      <Text size="sm" style={{ position: 'absolute', left: `${pace}%`, transform, whiteSpace: 'nowrap' }}>
        Today · {pace}% through the month
      </Text>
    </div>
  );
}

export function CategoryProgressRow({ progress, to, pace = null, paceCaption = false }: CategoryProgressRowProps) {
  const { name, spent, target, period, rawTarget, week } = progress;

  // A weekly target is measured against this week, not the whole month.
  const basisSpent = week ? week.spent : spent;
  const basisTarget = week ? week.target : target;
  const isOver = basisTarget > 0 && basisSpent > basisTarget;
  const percent = basisTarget > 0 ? Math.min(100, Math.round((basisSpent / basisTarget) * 100)) : 0;
  const showPace = pace !== null && !week;
  const rowStyle = {
    paddingBlock: 'var(--mantine-spacing-sm)',
    borderBottom: '1px solid var(--mantine-color-default-border)',
  };

  const content: ReactNode = (
    <Stack gap={4}>
      <Group justify="space-between" wrap="nowrap">
        <Text fw={500}>{name}</Text>
        <Text fw={600} c={isOver ? 'attention' : undefined}>
          {remainingLabel(basisSpent, basisTarget)}{week ? ' this week' : ''}
        </Text>
      </Group>
      {showPace && paceCaption && <PaceCaption pace={pace} />}
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
      <Text size="sm">
        {week
          ? `${formatPence(week.spent)} of ${formatPence(week.target)} this week`
          : `${formatPence(spent)} spent of ${formatPence(target)}${period === 'WEEKLY' ? ` · ${formatPence(rawTarget)} a week` : ''}`}
      </Text>
    </Stack>
  );

  if (!to) return <div style={rowStyle}>{content}</div>;

  return (
    <UnstyledButton
      component={Link}
      to={to}
      display="block"
      style={{ ...rowStyle, width: '100%' }}
    >
      {content}
    </UnstyledButton>
  );
}
