import { Code, List, Text } from '@mantine/core';
import type { FieldRow } from '~/lib/apiDocs';
import { InlineSpans } from './InlineText';

export function FieldList({ fields }: { fields: FieldRow[] }): React.JSX.Element {
  return (
    <List listStyleType="none" spacing="xs" size="sm" styles={{ root: { overflowWrap: 'anywhere' } }}>
      {fields.map((field) => (
        <List.Item key={field.name}>
          <Code>{field.name}</Code>{' '}
          <Text span size="sm" c="dimmed">{field.type}, {field.required ? 'required' : 'optional'}</Text>
          {field.description && <Text size="sm"><InlineSpans text={field.description} /></Text>}
          {field.children && <FieldList fields={field.children} />}
        </List.Item>
      ))}
    </List>
  );
}
