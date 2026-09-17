import { Alert, Anchor } from '@mantine/core';
import { Link, useLocation } from 'react-router';
import { useConnections } from '~/lib/queries';

export function AttentionBanner() {
  const { pathname } = useLocation();
  const connections = useConnections();
  const needsAttention = (connections.data ?? []).some(connection => connection.needsAttention);

  if (!needsAttention || pathname.startsWith('/banks')) return null;

  return (
    <Alert color="warning" mb="md">
      A bank connection needs attention.{' '}
      <Anchor component={Link} to="/banks">Review bank connections</Anchor>
    </Alert>
  );
}
