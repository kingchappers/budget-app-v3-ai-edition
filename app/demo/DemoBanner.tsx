import { useState } from 'react';
import { Alert, Button, Group, Text } from '@mantine/core';
import { demoControls } from './controls';
import { Mark } from '~/components/layout/Logo';

export default function DemoBanner() {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function reset(): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      await demoControls.reset();
      window.location.reload();
    } catch (error) {
      console.error('Could not reset the demo:', error instanceof Error ? error.name : 'Error');
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <section aria-label="Demo notice" style={{ marginBottom: 'var(--mantine-spacing-md)' }}>
      <Group justify="space-between" align="center" wrap="wrap" gap="xs">
        <Mark size={28} />
        <Text size="sm" style={{ flex: 1, minWidth: 220 }}>
          Demo: your changes stay in this browser tab and vanish when you reload. Don't enter real financial details.
        </Text>
        <Button size="xs" variant="default" onClick={() => void reset()} loading={busy}>Reset demo</Button>
      </Group>
      {failed && <Alert color="red" role="alert" mt="xs">Could not reset the demo. Reload the page instead.</Alert>}
    </section>
  );
}
