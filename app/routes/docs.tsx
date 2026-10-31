import { Stack, Text, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { ApiDocs } from '~/components/docs/ApiDocs';
import { isDemo } from '~/demo/flag';
import { useDocumentTitle } from '~/hooks/useDocumentTitle';
import { pageTitle } from '~/lib/pageTitle';
import type { Route } from './+types/docs';

const TITLE = 'API docs';

function DocsContent() {
  useDocumentTitle(pageTitle(TITLE));

  return (
    <Stack maw={720}>
      <Title order={1} size="h3">{TITLE}</Title>
      {isDemo
        ? <Text c="dimmed">The API docs are not available in the demo.</Text>
        : <ApiDocs />}
    </Stack>
  );
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle(TITLE) }];

export default function Docs() {
  return (
    <DefaultLayout>
      <DocsContent />
    </DefaultLayout>
  );
}
