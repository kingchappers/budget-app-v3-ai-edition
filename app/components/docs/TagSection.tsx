import { Accordion, Group, Text } from '@mantine/core';
import type { ApiSpec, OperationEntry, OperationGroup } from '~/lib/apiDocs';
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
    <div>
      <Group gap="xs" wrap="nowrap" align="baseline">
        <Text span fw={700} size="sm" ff="monospace">{entry.method}</Text>
        <Text span size="sm" ff="monospace" style={{ overflowWrap: 'anywhere', minWidth: 0 }}>{entry.path}</Text>
      </Group>
      {entry.operation.summary && <Text size="sm">{entry.operation.summary}</Text>}
      {access && <Text size="xs" c="dimmed">{access}</Text>}
    </div>
  );
}

export function TagSection({ spec, group, index }: { spec: ApiSpec; group: OperationGroup; index: number }): React.JSX.Element {
  return (
    <Accordion.Item value={`section-${index}`}>
      <Accordion.Control>{group.tag}</Accordion.Control>
      <Accordion.Panel>
        {group.description && <div><InlineText text={group.description} /></div>}
        <Accordion order={3} variant="separated">
          {group.operations.map((entry, opIndex) => (
            <Accordion.Item key={`${entry.method} ${entry.path}`} value={`section-${index}-operation-${opIndex}`}>
              <Accordion.Control><OperationLabel entry={entry} /></Accordion.Control>
              <Accordion.Panel><OperationView spec={spec} entry={entry} /></Accordion.Panel>
            </Accordion.Item>
          ))}
        </Accordion>
      </Accordion.Panel>
    </Accordion.Item>
  );
}
