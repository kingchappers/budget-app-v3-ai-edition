import { useState } from 'react';
import { Alert, Button, PasswordInput, Stack, Text, TextInput } from '@mantine/core';

const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

interface Props {
  setupRequired: boolean;
  onLogin(email: string, password: string): Promise<void>;
  onSetup(input: { code: string; email: string; password: string }): Promise<void>;
}

export function LocalAuthForm({ setupRequired, onLogin, onSetup }: Props) {
  const [code, setCode] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (setupRequired && password.length < MIN_PASSWORD_LENGTH) {
      setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (setupRequired) await onSetup({ code: code.trim(), email: email.trim(), password });
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
            <Text size="sm">Create the account for this instance. The setup code is printed once in the server log when the server first handles a request; restarting before you finish makes a new one.</Text>
            <TextInput label="Setup code" value={code} onChange={e => setCode(e.currentTarget.value)} required withAsterisk={false} autoComplete="off" />
          </>
        )}
        <Text size="sm" c="dimmed">All fields are required.</Text>
        <TextInput label="Email" type="email" value={email} onChange={e => setEmail(e.currentTarget.value)} required withAsterisk={false} autoComplete="username" />
        <PasswordInput
          label="Password"
          value={password}
          onChange={e => setPassword(e.currentTarget.value)}
          required
          withAsterisk={false}
          maxLength={MAX_PASSWORD_LENGTH}
          description={setupRequired ? `At least ${MIN_PASSWORD_LENGTH} characters` : undefined}
          autoComplete={setupRequired ? 'new-password' : 'current-password'}
        />
        {error && <Alert color="red" role="alert">{error}</Alert>}
        <Button type="submit" loading={busy}>{setupRequired ? 'Create account' : 'Sign in'}</Button>
      </Stack>
    </form>
  );
}
