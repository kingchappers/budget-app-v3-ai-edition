import { Alert, Anchor, Button, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { Link } from 'react-router';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { InboxRow } from '~/components/inbox/InboxRow';
import { accountLabel, describeSyncAge } from '~/lib/banks';
import { groupByBookingDate } from '~/lib/inbox';
import {
  useCategories, useConfirmInboxItem, useConnections, useIgnoreInboxItem, useInbox, useSyncStatus,
} from '~/lib/queries';

function InboxContent() {
  const inbox = useInbox();
  const categories = useCategories();
  const connections = useConnections();
  const status = useSyncStatus();
  const confirm = useConfirmInboxItem();
  const ignore = useIgnoreInboxItem();

  const items = inbox.data?.pages.flatMap(page => page.items) ?? [];
  const groups = groupByBookingDate(items);

  return (
    <Stack>
      <Group justify="space-between" wrap="wrap">
        <Title order={2}>Inbox</Title>
        <Anchor component={Link} to="/banks" size="sm">Manage banks</Anchor>
      </Group>

      {(confirm.isError || ignore.isError) && (
        <Alert color="danger">That change could not be saved. The item is back in your inbox.</Alert>
      )}
      {inbox.isLoading && <Loader size="sm" />}
      {inbox.isError && <Alert color="danger">Could not load your inbox.</Alert>}

      {inbox.isSuccess && items.length === 0 && (
        <Stack gap={4} align="center" py="xl">
          <Text fw={600}>All caught up</Text>
          <Text size="sm" c="dimmed">{describeSyncAge(status.data?.finishedAt ?? null, Date.now())}</Text>
        </Stack>
      )}

      {groups.map(group => (
        <Stack key={group.date} gap="xs">
          <Text size="sm" fw={600} c="dimmed">{group.date}</Text>
          {group.items.map(item => (
            <InboxRow
              key={item.txnKey}
              item={item}
              accountLabel={accountLabel(connections.data ?? [], item.connectionId, item.accountUid)}
              categories={categories.data ?? []}
              onConfirm={input => confirm.mutate({ item, input })}
              onIgnore={() => ignore.mutate(item)}
            />
          ))}
        </Stack>
      ))}

      {inbox.hasNextPage && (
        <Button variant="light" onClick={() => inbox.fetchNextPage()} loading={inbox.isFetchingNextPage}>
          Load more
        </Button>
      )}
    </Stack>
  );
}

export default function Inbox() {
  return (
    <DefaultLayout>
      <InboxContent />
    </DefaultLayout>
  );
}
