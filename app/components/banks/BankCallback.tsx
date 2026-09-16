import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Group, Loader, Stack, Text } from '@mantine/core';
import { useAuth0 } from '@auth0/auth0-react';
import { Link, useNavigate } from 'react-router';
import { ApiError } from '~/lib/apiError';
import {
  BANK_CALLBACK_PATH, clearStashedBankCallback, readBankCallback, readStashedBankCallback, stashBankCallback,
} from '~/lib/bankCallback';
import { useCompleteBankCallback } from '~/lib/queries';

const EXPIRED_MESSAGE = 'This connection attempt has expired. Please start again.';
const FAILED_MESSAGE = 'We could not finish connecting your bank. Please try again.';
const MISSING_STATE_MESSAGE = 'Start the bank connection again from the Banks page.';
const TIMEOUT_MESSAGE = 'This is taking longer than expected. Please try again shortly.';

// The backend resolves a connection from `state` alone (no code exchange), and
// may still be finishing the handshake with the bank when we first ask. We poll
// a bounded number of times rather than treating "not ready yet" as failure —
// (MAX_POLL_ATTEMPTS - 1) * POLL_INTERVAL_MS = 3.2s of total wait, comfortably
// more than the backend's own single-shot pollConnectionStatus call (Task 27)
// needs to settle, without leaving the user staring at a spinner for long.
export const POLL_INTERVAL_MS = 800;
export const MAX_POLL_ATTEMPTS = 5;

type Status = { kind: 'loading' } | { kind: 'error'; message: string; canRetry: boolean };

export function BankCallback({ storage = window.sessionStorage }: { storage?: Storage }) {
  const { isLoading, isAuthenticated, loginWithRedirect } = useAuth0();
  const navigate = useNavigate();
  const complete = useCompleteBankCallback();
  const [errorParams] = useState(() => readBankCallback(window.location.search));
  const [stashed] = useState(() => readStashedBankCallback(storage));
  const [status, setStatus] = useState<Status>({ kind: 'loading' });
  const [attempt, setAttempt] = useState(0);
  // Bumped on every Retry click so the polling effect always re-runs, even when
  // a first-attempt error (attempt === 1) means setAttempt(1) alone would be a
  // same-value update React bails out of.
  const [retryToken, setRetryToken] = useState(0);
  const started = useRef(false);

  useEffect(() => {
    // Keep any redirect params out of browser history and referrers.
    if (window.location.search) window.history.replaceState(null, '', BANK_CALLBACK_PATH);
  }, []);

  useEffect(() => {
    if (isLoading || started.current) return;
    started.current = true;

    if (errorParams.kind === 'error') {
      clearStashedBankCallback(storage);
      setStatus({ kind: 'error', message: errorParams.message, canRetry: false });
      return;
    }

    if (!stashed) {
      setStatus({ kind: 'error', message: MISSING_STATE_MESSAGE, canRetry: false });
      return;
    }

    if (!isAuthenticated) {
      stashBankCallback(storage, stashed);
      void loginWithRedirect({ appState: { returnTo: BANK_CALLBACK_PATH } });
      return;
    }

    setAttempt(1);
    // Intentionally runs once isLoading settles; errorParams/stashed are stable
    // (read once via useState initializers) and the mutation/navigate/loginWithRedirect
    // functions are not meant to re-trigger this setup.
  }, [isLoading]);

  useEffect(() => {
    if (attempt < 1 || !stashed) return;
    let cancelled = false;

    complete.mutateAsync(stashed.state)
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'READY') {
          clearStashedBankCallback(storage);
          navigate('/banks', { replace: true });
          return;
        }
        if (attempt >= MAX_POLL_ATTEMPTS) {
          clearStashedBankCallback(storage);
          setStatus({ kind: 'error', message: TIMEOUT_MESSAGE, canRetry: true });
          return;
        }
        setTimeout(() => {
          if (!cancelled) setAttempt(a => a + 1);
        }, POLL_INTERVAL_MS);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        clearStashedBankCallback(storage);
        setStatus({
          kind: 'error',
          message: error instanceof ApiError && error.status === 404 ? EXPIRED_MESSAGE : FAILED_MESSAGE,
          canRetry: !(error instanceof ApiError && error.status === 404),
        });
      });

    return () => { cancelled = true; };
    // Intentionally re-runs on attempt or retryToken; stashed/complete/navigate/storage
    // are stable for a given mount. retryToken guarantees a re-run even when a Retry
    // click resets attempt to a value it already held (e.g. a first-attempt error).
  }, [attempt, retryToken]);

  if (status.kind === 'error') {
    const onRetry = status.canRetry
      ? () => { setStatus({ kind: 'loading' }); setAttempt(1); setRetryToken(t => t + 1); }
      : undefined;
    return <CallbackAlert title="Bank not connected" message={status.message} onRetry={onRetry} />;
  }

  return (
    <Group justify="center" mt="xl">
      <Loader size="sm" />
      <Text>Finishing your bank connection…</Text>
    </Group>
  );
}

function CallbackAlert({ title, message, onRetry }: { title: string; message: string; onRetry?: () => void }) {
  return (
    <Stack maw={480} mx="auto" mt="xl">
      <Alert color="danger" title={title}>
        <Text size="sm">{message}</Text>
      </Alert>
      <Group>
        {onRetry && <Button onClick={onRetry} variant="filled">Retry</Button>}
        <Button component={Link} to="/banks" variant="light">Back to banks</Button>
      </Group>
    </Stack>
  );
}
