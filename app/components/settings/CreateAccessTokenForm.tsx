import { useId, useState } from 'react';
import { Button, Group, Input, PasswordInput, SegmentedControl, Select, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertTriangle } from '@tabler/icons-react';
import { useAuth } from '~/lib/auth';
import type { AccessTokenInput } from '~/lib/api';
import type { AccessTokenScope } from '~/lib/types';
import { EXPIRY_OPTIONS, NEVER, SCOPE_LABELS, createErrorText, expiryDaysFor } from './accessTokenText';

const NAME_MAX = 60;
const DEFAULT_EXPIRY = '90';
const SCOPE_OPTIONS = [
  { value: 'read', label: SCOPE_LABELS.read },
  { value: 'write', label: SCOPE_LABELS.write },
];

function Warning({ children }: { children: string }): React.JSX.Element {
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start" role="note">
      <IconAlertTriangle size={18} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
      <Text size="sm">{children}</Text>
    </Group>
  );
}

interface CreateAccessTokenFormProps {
  onCreate: (input: AccessTokenInput) => Promise<void>;
}

export function CreateAccessTokenForm({ onCreate }: CreateAccessTokenFormProps): React.JSX.Element {
  const { mode } = useAuth();
  const headingId = useId();
  const [name, setName] = useState('');
  const [scope, setScope] = useState<AccessTokenScope>('read');
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY);
  const [password, setPassword] = useState('');
  const [nameError, setNameError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const asksForPassword = mode === 'local' && scope === 'write';

  function reset(): void {
    setName('');
    setScope('read');
    setExpiry(DEFAULT_EXPIRY);
    setPassword('');
  }

  function inputFromForm(): AccessTokenInput | null {
    const trimmed = name.trim();
    const missingName = trimmed === '';
    const missingPassword = asksForPassword && password === '';
    setNameError(missingName ? 'Give the token a name.' : null);
    setPasswordError(missingPassword ? 'Enter your password to continue.' : null);
    if (missingName || missingPassword) return null;

    const input: AccessTokenInput = { name: trimmed, scope, expiryDays: expiryDaysFor(expiry) };
    if (asksForPassword) input.password = password;
    return input;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setFailure(null);
    const input = inputFromForm();
    if (!input) return;

    setBusy(true);
    try {
      await onCreate(input);
      reset();
    } catch (error) {
      console.error('Creating an access token failed', { scope: input.scope, error });
      setFailure(createErrorText(error));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form noValidate aria-labelledby={headingId} onSubmit={event => void submit(event)}>
      <Stack gap="md">
        <Title order={3} size="h5" id={headingId}>Create a token</Title>
        <TextInput
          label="Name"
          description="So you can tell your tokens apart, for example the tool that uses it."
          required
          maxLength={NAME_MAX}
          value={name}
          error={nameError}
          onChange={event => setName(event.currentTarget.value)}
        />
        <Input.Wrapper label="Access">
          <SegmentedControl
            fullWidth
            mt={4}
            aria-label="Access"
            value={scope}
            onChange={value => setScope(value as AccessTokenScope)}
            data={SCOPE_OPTIONS}
          />
        </Input.Wrapper>
        {scope === 'write' && <Warning>This token can add, change and delete your data. Only give it to tools you trust.</Warning>}
        <Select
          label="Expires after"
          data={EXPIRY_OPTIONS}
          value={expiry}
          allowDeselect={false}
          onChange={value => { if (value !== null) setExpiry(value); }}
        />
        {expiry === NEVER && <Warning>This token stays valid until you revoke it.</Warning>}
        {asksForPassword && (
          <PasswordInput
            label="Your password"
            description="Needed to create a token that can change your data."
            autoComplete="current-password"
            value={password}
            error={passwordError}
            onChange={event => setPassword(event.currentTarget.value)}
          />
        )}
        {failure && <Text size="sm" role="alert">{failure}</Text>}
        <Button type="submit" loading={busy} style={{ alignSelf: 'flex-start' }}>Create token</Button>
      </Stack>
    </form>
  );
}
