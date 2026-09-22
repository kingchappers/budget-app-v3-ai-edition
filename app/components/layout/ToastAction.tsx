import { Button, Group, Text } from '@mantine/core';

export const TOAST_MS = 5000;

export interface ToastActionProps {
  text: string;
  actionLabel: string;
  onAction: () => void;
}

export function ToastAction({ text, actionLabel, onAction }: ToastActionProps) {
  return (
    <Group justify="space-between" wrap="nowrap" gap="sm">
      <Text size="sm">{text}</Text>
      <Button variant="subtle" size="compact-sm" onClick={onAction}>{actionLabel}</Button>
    </Group>
  );
}
