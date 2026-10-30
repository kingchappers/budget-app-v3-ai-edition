import { Button, Group, Text } from '@mantine/core';

// The demo's whole backend lives in memory and is rebuilt on every load, so a reload is a reset.
export default function DemoBanner() {
  return (
    <section aria-label="Demo notice" style={{ marginBottom: 'var(--mantine-spacing-md)' }}>
      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
        <Text size="sm">
          This is the Hoardwise demo: your changes stay in this browser tab and vanish when you reload. Don't enter real financial details.
        </Text>
        <Button size="xs" variant="default" onClick={() => window.location.reload()}>Reset demo</Button>
      </Group>
    </section>
  );
}
