import { useId } from 'react';
import { Code, List, Paper, Stack, Text, Title } from '@mantine/core';
import { exampleCurl } from '~/lib/apiDocs';

const wrappedCodeStyle = { whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', maxWidth: '100%' } as const;

export function GettingStarted(): React.JSX.Element {
  const headingId = useId();
  const curl = exampleCurl({ method: 'GET', path: '/api/categories' });
  return (
    <Paper component="section" withBorder p="md" aria-labelledby={headingId}>
      <Stack gap="sm">
        <Title order={2} size="h4" id={headingId}>Getting started</Title>
        <List type="ordered" listStyleType="decimal" size="sm" spacing="xs">
          <List.Item>Create a read token under Settings, in Access tokens.</List.Item>
          <List.Item>
            Send it with every request as <Code>Authorization: Bearer $HOARDWISE_TOKEN</Code>.
          </List.Item>
          <List.Item>
            The base URL is this site&apos;s address: <Code style={{ overflowWrap: 'anywhere' }}>{window.location.origin}</Code>. Set it as <Code>HOARDWISE_URL</Code>.
          </List.Item>
        </List>
        <Text size="sm">Try it by listing your categories:</Text>
        <Code block style={wrappedCodeStyle}>{curl}</Code>
        <Text size="sm">A read token can only look. It cannot change anything.</Text>
        <Text size="sm">
          Tools and agents can read <Code>GET /api/openapi.json</Code> for the full spec, or <Code>GET /api/docs/agents</Code> for a compact reference.
        </Text>
      </Stack>
    </Paper>
  );
}
