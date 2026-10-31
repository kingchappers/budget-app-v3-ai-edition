import { Accordion, Group, Text } from '@mantine/core';
import type { ApiSpec, OperationEntry, OperationGroup } from '~/lib/apiDocs';
import { accordionValue } from './accordionValue';
import { InlineText } from './InlineText';
import { OperationView } from './OperationView';

const ACCESS_WORDS: Record<string, string> = {
  none: 'Sign-in only, no token',
  read: 'Any token',
  write: 'Write token only',
};

function OperationLabel({ entry }: { entry: OperationEntry }): React.JSX.Element {
  const access = ACCESS_WORDS[entry.operation['x-token-access'] ?? ''];
  return (
    <span>
      <Group gap="xs" wrap="nowrap" align="baseline">
        <Text span fw={700} size="sm" ff="monospace">{entry.method}</Text>
        <Text span size="sm" ff="monospace" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{entry.path}</Text>
      </Group>
      {entry.operation.summary && <Text component="span" display="block" size="sm">{entry.operation.summary}</Text>}
      {access && <Text component="span" display="block" size="xs" c="dimmed">{access}</Text>}
    </span>
  );
}

export function TagSection({ spec, group }: { spec: ApiSpec; group: OperationGroup }): React.JSX.Element {
  return (
    <Accordion.Item value={accordionValue(group.tag)}>
      <Accordion.Control>{group.tag}</Accordion.Control>
      <Accordion.Panel>
        {group.description && <div><InlineText text={group.description} /></div>}
        <Accordion order={3} variant="separated">
          {group.operations.map((entry) => (
            <Accordion.Item key={`${entry.method} ${entry.path}`} value={accordionValue(entry.method, entry.path)}>
              <Accordion.Control><OperationLabel entry={entry} /></Accordion.Control>
              <Accordion.Panel><OperationView spec={spec} entry={entry} /></Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
