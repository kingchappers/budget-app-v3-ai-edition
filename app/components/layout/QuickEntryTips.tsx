import { useState } from 'react';
import { ActionIcon, Kbd, Modal, Stack, Text } from '@mantine/core';
import { IconHelp } from '@tabler/icons-react';

export function QuickEntryTips() {
  const [opened, setOpened] = useState(false);

  return (
    <>
      <ActionIcon variant="subtle" size="lg" aria-label="Quick entry tips" onClick={() => setOpened(true)}>
        <IconHelp size={20} />
      </ActionIcon>
      <Modal opened={opened} onClose={() => setOpened(false)} title="Quick entry tips" centered>
        <Stack gap="sm">
          <Text size="sm">
            <Kbd>N</Kbd> (keyboard) or the + button opens Add transaction.
          </Text>
          <Text size="sm">
            <strong>Quick add:</strong> type coffee 3.50 (or 3.50 coffee) and press Enter to fill the form.
            Start the amount with + for income (+2400 salary). It never saves by itself.
          </Text>
          <Text size="sm">
            <strong>Remembered categories:</strong> type a note you have used before and its category is
            suggested, based on the last three months.
          </Text>
          <Text size="sm">
            <strong>Save &amp; add another:</strong> Enter in any other field saves and keeps the sheet open
            for the next entry. An Undo toast follows each save.
          </Text>
          <Text size="sm">
            <strong>Duplicate:</strong> on the Transactions page, open a row's menu and choose Duplicate.
          </Text>
          <Text size="sm">
            <strong>Recurring:</strong> choose Repeat monthly in a transaction's menu to set one up. When it is
            due it appears at the top of Home with Add, Edit and Skip. Manage them under Recurring.
          </Text>
        </Stack>
      </Modal>
    </>
  );
}
