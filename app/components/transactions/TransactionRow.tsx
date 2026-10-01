import { useRef } from 'react';
import { ActionIcon, Button, Group, Loader, Menu, Text, ThemeIcon, UnstyledButton } from '@mantine/core';
import { IconClock, IconCopy, IconDots, IconPencil, IconRepeat, IconTrash } from '@tabler/icons-react';
import { formatPence } from '~/lib/money';
import { formatDayLabel, todayIso } from '~/lib/months';
import { CategoryIcon } from '~/components/categories/CategoryIcon';
import type { Transaction } from '~/lib/types';

const OUTGOING = new Set(['EXPENSE', 'SET_ASIDE']);

function SyncStatus({ label, saving, pending, pendingError, onRetry }: {
  label: string;
  saving?: boolean;
  pending?: boolean;
  pendingError?: string;
  onRetry?: () => void;
}) {
  if (pending && pendingError) {
    return (
      <Group gap={6} mt={2}>
        <IconClock size={12} color="var(--mantine-color-warning-6)" aria-hidden />
        <Text size="sm">Not synced. Tap to retry.</Text>
        {onRetry && (
          <Button size="compact-sm" variant="light" aria-label={`Retry syncing ${label}`} onClick={onRetry}>Retry</Button>
        )}
      </Group>
    );
  }
  if (pending) {
    return (
      <Group gap={4} mt={2}>
        <IconClock size={12} color="var(--mantine-color-dimmed)" aria-hidden />
        <Text size="sm">Waiting to sync</Text>
      </Group>
    );
  }
  if (saving) {
    return (
      <Group gap={4} mt={2}>
        <Loader size={10} aria-hidden />
        <Text size="sm">Saving</Text>
      </Group>
    );
  }
  return null;
}

export function TransactionRow({
  transaction, categoryName, categoryIcon, onEdit, onDelete, onDuplicate, onRepeat, saving, pending, pendingError, onRetry, onDiscard,
}: {
  transaction: Transaction;
  categoryName: string;
  categoryIcon: string;
  onEdit?: (t: Transaction) => void;
  onDelete?: (t: Transaction) => void;
  onDuplicate?: (t: Transaction) => void;
  onRepeat?: (t: Transaction) => void;
  // Sent but not yet confirmed by the server (not queued offline).
  saving?: boolean;
  pending?: boolean;
  pendingError?: string;
  onRetry?: () => void;
  // Only meaningful while pending: removes it from the offline queue instead
  // of the normal online delete, which would just recreate it on the next sync.
  onDiscard?: (t: Transaction) => void;
}) {
  const label = transaction.description || categoryName;
  const sign = OUTGOING.has(transaction.type) ? '−' : '+';
  const actionsRef = useRef<HTMLButtonElement>(null);
  const opensSheetRef = useRef(false);

  const summary = (
    <Group gap="sm" wrap="nowrap" style={{ minWidth: 0 }}>
      <ThemeIcon variant="light" color="primary" radius="xl" size={32}>
        <CategoryIcon icon={categoryIcon} />
      </ThemeIcon>
      <div style={{ minWidth: 0 }}>
        <Text truncate>{label}</Text>
        <Text size="sm">{categoryName} · {formatDayLabel(transaction.date, todayIso())}</Text>
        <SyncStatus label={label} saving={saving} pending={pending} pendingError={pendingError} onRetry={onRetry} />
      </div>
    </Group>
  );

  return (
    <Group justify="space-between" wrap="wrap" py={4}>
      {onEdit && !pending ? (
        <UnstyledButton
          aria-label={`Edit ${label}`}
          onClick={() => onEdit(transaction)}
          style={{ flex: '1 1 10rem', minWidth: 0, borderRadius: 'var(--mantine-radius-sm)' }}
        >
          {summary}
        </UnstyledButton>
      ) : summary}
      <Group gap="xs" wrap="nowrap">
        <Text fw={500}>{sign}{formatPence(transaction.amount)}</Text>
        {onDuplicate && !pending && (
          <Button
            variant="subtle"
            size="compact-sm"
            leftSection={<IconCopy size={14} />}
            aria-label={`Duplicate ${label}`}
            onClick={() => onDuplicate(transaction)}
          >
            Duplicate
          </Button>
        )}
        {pending ? (
          onDiscard && (
            <Menu position="bottom-end">
              <Menu.Target>
                <ActionIcon variant="subtle" aria-label={`Actions for ${label}`}><IconDots size={16} /></ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {/* Edit and Delete are hidden while pending: this row hasn't
                    reached the server, so a normal edit or delete would just
                    be overwritten or resurrected by the next sync. */}
                <Menu.Item color="danger" leftSection={<IconTrash size={14} />} onClick={() => onDiscard(transaction)}>Discard</Menu.Item>
              </Menu.Dropdown>
            </Menu>
          )
        ) : (
          (onEdit || onDelete || onRepeat) && (
            // Edit/Repeat monthly each open a ResponsiveSheet elsewhere in the tree
            // on the same render this menu closes. Mantine's default returnFocus schedules a
            // focus() back onto this Actions button 10ms after close (useFocusReturn), which
            // races the opened sheet's own focus trap and can steal focus back out of it. We
            // disable the built-in returnFocus and restore it ourselves in onClose, but only
            // when the item that closed the menu isn't about to open a sheet -- Delete and a
            // plain Escape/outside-click dismissal still get the normal focus-return behaviour.
            <Menu
              position="bottom-end"
              returnFocus={false}
              onClose={() => {
                if (!opensSheetRef.current) actionsRef.current?.focus();
                opensSheetRef.current = false;
              }}
            >
              <Menu.Target>
                <ActionIcon ref={actionsRef} variant="subtle" aria-label={`Actions for ${label}`}><IconDots size={16} /></ActionIcon>
              </Menu.Target>
              <Menu.Dropdown>
                {onEdit && <Menu.Item leftSection={<IconPencil size={14} />} onClick={() => { opensSheetRef.current = true; onEdit(transaction); }}>Edit</Menu.Item>}
                {onRepeat && <Menu.Item leftSection={<IconRepeat size={14} />} onClick={() => { opensSheetRef.current = true; onRepeat(transaction); }}>Repeat monthly</Menu.Item>}
                {onDelete && <Menu.Item color="danger" leftSection={<IconTrash size={14} />} onClick={() => onDelete(transaction)}>Delete</Menu.Item>}
              </Menu.Dropdown>
            </Menu>
          )
        )}
      </Group>
    </Group>
  );
}
