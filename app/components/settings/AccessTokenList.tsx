import { useId, useRef, useState } from 'react';
import { Button, Group, Paper, Stack, Text } from '@mantine/core';
import { IconEye, IconPencil } from '@tabler/icons-react';
import { useAccessTokens, useRevokeAccessToken } from '~/lib/queries';
import type { AccessToken, AccessTokenScope } from '~/lib/types';
import { SCOPE_LABELS, expiryText, formatTokenDate, lastUsedText } from './accessTokenText';

const REVOKE_FAILED = "Couldn't revoke that token. Try again.";

function ScopeLabel({ scope }: { scope: AccessTokenScope }): React.JSX.Element {
  const Icon = scope === 'write' ? IconPencil : IconEye;
  return (
    <Group gap={6} wrap="nowrap">
      <Icon size={18} aria-hidden="true" />
      <Text size="sm">{SCOPE_LABELS[scope]}</Text>
    </Group>
  );
}

interface RevokeConfirmationProps {
  name: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

function RevokeConfirmation({ name, busy, onConfirm, onCancel }: RevokeConfirmationProps): React.JSX.Element {
  return (
    <Stack gap="xs" mt="sm">
      <Text size="sm">Revoke “{name}”? Anything using it will stop working.</Text>
      <Group gap="sm">
        <Button color="ember" loading={busy} onClick={onConfirm}>Revoke token</Button>
        <Button variant="default" autoFocus disabled={busy} onClick={onCancel}>Cancel</Button>
      </Group>
    </Stack>
  );
}

function AccessTokenRow({ token }: { token: AccessToken }): React.JSX.Element {
  const revoke = useRevokeAccessToken();
  const nameId = useId();
  const revokeButton = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  function cancel(): void {
    setConfirming(false);
    revokeButton.current?.focus();
  }

  async function confirm(): Promise<void> {
    setBusy(true);
    setFailed(false);
    try {
      await revoke.mutateAsync(token.tokenId);
    } catch (error) {
      console.error('Revoking an access token failed', { tokenId: token.tokenId, error });
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Paper component="li" withBorder p="sm" aria-labelledby={nameId}>
      <Group justify="space-between" align="flex-start" wrap="nowrap">
        <Stack gap={4}>
          <Group gap="xs">
            <Text fw={600} id={nameId}>{token.name}</Text>
            <Text size="sm" ff="monospace">{token.prefix}…</Text>
          </Group>
          <ScopeLabel scope={token.scope} />
          <Text size="sm">Created {formatTokenDate(token.createdAt)}</Text>
          <Text size="sm">{expiryText(token)}</Text>
          <Text size="sm">{lastUsedText(token)}</Text>
        </Stack>
        <Button ref={revokeButton} variant="default" aria-label={`Revoke ${token.name}`} onClick={() => setConfirming(true)}>
          Revoke
        </Button>
      </Group>
      {confirming && <RevokeConfirmation name={token.name} busy={busy} onConfirm={() => void confirm()} onCancel={cancel} />}
      {failed && <Text size="sm" mt="xs" role="alert">{REVOKE_FAILED}</Text>}
    </Paper>
  );
}

export function AccessTokenList(): React.JSX.Element {
  const { data, isLoading, error, refetch } = useAccessTokens();

  if (isLoading) return <Text size="sm">Loading your access tokens…</Text>;

  if (error) {
    return (
      <Group gap="sm">
        <Text size="sm" role="alert">Couldn't load your access tokens.</Text>
        <Button variant="default" onClick={() => void refetch()}>Try again</Button>
      </Group>
    );
  }

  if (!data || data.length === 0) return <Text size="sm">No access tokens yet.</Text>;

  return (
    <Stack component="ul" gap="sm" p={0} m={0} style={{ listStyle: 'none' }}>
      {data.map(token => <AccessTokenRow key={token.tokenId} token={token} />)}
    </Stack>
  );
}
