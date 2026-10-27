import { useState } from 'react';
import { Alert, Anchor, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;
const DOCS_URL = 'https://github.com/kingchappers/hoardwise/blob/main/docs/SELF-HOSTING.md#forgot-your-password';

interface Props {
  setupRequired: boolean;
  recoveryOpen?: boolean;
  onLogin(email: string, password: string): Promise<void>;
  onSetup(input: { code: string; email: string; password: string }): Promise<void>;
  onRecover?(input: { code: string; password: string }): Promise<void>;
}

export function LocalAuthForm({ setupRequired, recoveryOpen = false, onLogin, onSetup, onRecover }: Props) {
  const recovering = !setupRequired && recoveryOpen;
  const choosingPassword = setupRequired || recovering;
  let submitLabel = 'Sign in';
  if (recovering) submitLabel = 'Set new password';
  else if (setupRequired) submitLabel = 'Create account';
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (choosingPassword && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (recovering) await onRecover?.({ code: code.trim(), password });
      else if (setupRequired) await onSetup({ code: code.trim(), email: email.trim(), password });
      else await onLogin(email.trim(), password);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit}>
      <Stack>
        {setupRequired && (
          <>
            <Text size="sm">Create the account for this instance. Your setup code is in your host's logs (for example, on PikaPods: More, then Show Logs) or in the file SETUP_CODE.txt in your data folder. Restarting before you finish makes a new one.</Text>
            <TextInput label="Setup code" value={code} onChange={e => setCode(e.currentTarget.value)} required withAsterisk={false} autoComplete="off" />
          </>
        )}
        {recovering && (
          <>
            <Text size="sm">Password recovery is open. Enter the recovery code from your host's logs (or SETUP_CODE.txt in your data folder) and choose a new password. Your data is not changed.</Text>
            <TextInput label="Recovery code" value={code} onChange={e => setCode(e.currentTarget.value)} required withAsterisk={false} autoComplete="off" />
          </>
        )}
        <Text size="sm" c="dimmed">All fields are required.</Text>
        {!recovering && (
          <TextInput label="Email" type="email" value={email} onChange={e => setEmail(e.currentTarget.value)} required withAsterisk={false} autoComplete="username" />
        )}
        <PasswordInput
          label={recovering ? 'New password' : 'Password'}
          value={password}
          onChange={e => setPassword(e.currentTarget.value)}
          required
          withAsterisk={false}
          maxLength={MAX_PASSWORD_LENGTH}
          description={choosingPassword ? `At least ${MIN_PASSWORD_LENGTH} characters` : undefined}
          autoComplete={choosingPassword ? 'new-password' : 'current-password'}
        />
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Button type="submit" loading={busy}>{submitLabel}</Button>
        {!choosingPassword && (
          <Text size="xs" c="dimmed">
            Forgot your password? <Anchor href={DOCS_URL} target="_blank" rel="noopener noreferrer" size="xs">How to reset it</Anchor>
          </Text>
        )}
      </Stack>
    </form>
  );
}
