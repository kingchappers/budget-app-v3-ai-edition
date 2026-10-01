import { ActionIcon, Popover, Stack, Text } from '@mantine/core';
import { IconHelpCircle } from '@tabler/icons-react';
import { GLOSSARY, type GlossaryKey } from '~/lib/glossary';

// A small "What's this?" button that opens one plain sentence and an example
// for each term it is given. The 44px size is the touch target, not the icon.
export function TermHelp({ terms }: { terms: GlossaryKey[] }) {
  const label = terms.map(key => GLOSSARY[key].term).join(', ');
  return (
    <Popover width={280} position="bottom" withArrow shadow="md" trapFocus returnFocus>
      <Popover.Target>
        <ActionIcon
          variant="subtle"
          color="gray"
          aria-label={`What's this? ${label}`}
          style={{ minWidth: 44, minHeight: 44 }}
        >
          <IconHelpCircle size={20} />
        </ActionIcon>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          {terms.map(key => (
            <div key={key}>
              <Text fw={600} size="sm">{GLOSSARY[key].term}</Text>
              <Text size="sm">{GLOSSARY[key].definition}</Text>
              <Text size="sm" c="dimmed">For example: {GLOSSARY[key].example}</Text>
            </div>
          ))}
        </Stack>
      </Popover.Dropdown>
    </Popover>
  );
}
