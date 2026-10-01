import { List, Stack, Title } from '@mantine/core';

// The few things worth knowing, in plain sentences, before any chart.
export function InsightsHeadline({ sentences }: { sentences: string[] }) {
  if (sentences.length === 0) return null;
  return (
    <Stack gap="xs">
      <Title order={5}>What stood out</Title>
      <List spacing="xs" listStyleType="none" aria-label="What stood out">
        {sentences.map(sentence => <List.Item key={sentence}>{sentence}</List.Item>)}
      </List>
    </Stack>
  );
}
