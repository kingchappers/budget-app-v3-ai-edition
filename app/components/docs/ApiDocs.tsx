import { useState } from 'react';
import { Group, Loader, Stack, Text, TextInput, Accordion } from '@mantine/core';
import { LoadError } from '~/components/layout/LoadError';
import { filterOperations, groupOperationsByTag } from '~/lib/apiDocs';
import { useApiSpec } from '~/lib/queries';
import { GettingStarted } from './GettingStarted';
import { TagSection } from './TagSection';

export function ApiDocs(): React.JSX.Element {
  const spec = useApiSpec();
  const [query, setQuery] = useState('');

  if (spec.error) return <LoadError thing="API docs" onRetry={() => spec.refetch()} />;
  if (spec.isLoading || !spec.data) {
    return <Group justify="center" py="xl"><Loader role="status" aria-label="Loading the API docs" /></Group>;
  }

  const groups = filterOperations(groupOperationsByTag(spec.data), query);

  return (
    <Stack>
      <GettingStarted />
      <TextInput label="Filter" description="Search by section, path or summary." value={query} onChange={(event) => setQuery(event.currentTarget.value)} />
      {groups.length === 0 ? (
        <Text c="dimmed">Nothing matches that. Try a shorter word.</Text>
      ) : (
        <Accordion order={2} variant="separated">
          {groups.map((group, index) => <TagSection key={group.tag} spec={spec.data} group={group} index={index} />)}
        </Accordion>
      )}
    </Stack>
  );
}
