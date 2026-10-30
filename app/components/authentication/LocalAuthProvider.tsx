import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Group, Modal } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { LocalAuthContext } from '~/lib/auth';
import type { AuthState } from '~/lib/auth';
import { clearSessionEnded } from '~/lib/session';
import {
  ensureLocalAuth, getLocalAuthState, loginLocal, logoutLocal, recoverLocal, refreshLocalAuth, setupLocal, subscribeLocalAuth,
} from '~/lib/localAuth';
import { LocalAuthForm } from './LocalAuthForm';
import { Logo } from '../layout/Logo';

type FormMode = 'recovery' | 'setup' | 'login';

function formMode(setupRequired: boolean, recoveryOpen: boolean): FormMode {
  if (setupRequired) return 'setup';
  if (recoveryOpen) return 'recovery';
  return 'login';
}

const FORM_TITLES: Record<FormMode, string> = {
  recovery: 'Set a new password',
  setup: 'Create your account',
  login: 'Sign in',
};

export function LocalAuthProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribeLocalAuth, getLocalAuthState, getLocalAuthState);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => { void ensureLocalAuth(); }, []);
  useEffect(() => {
    if (snapshot.status !== 'signedIn') return;
    clearSessionEnded();
    setFormOpen(false); // a later session expiry must not pop the form open unprompted
  }, [snapshot.status]);

  const login = useCallback(() => {
    setFormOpen(true);
    void refreshLocalAuth(); // setup or recovery may have opened (or closed) since the page loaded
  }, []);
  const logout = useCallback(async () => {
    try {
      await logoutLocal();
    } catch (error) {
      console.error('Sign out failed:', error);
      notifications.show({ color: 'red', message: 'Could not sign out. Please try again.' });
      return;
    }
    window.location.assign('/'); // a fresh load drops every in-memory cache, as Auth0's redirect does
  }, []);
  const getToken = useCallback(async () => undefined, []);

  const value = useMemo<AuthState>(() => ({
    mode: 'local',
    isAuthenticated: snapshot.status === 'signedIn',
    isLoading: snapshot.status === 'loading',
    user: snapshot.status === 'signedIn' ? { sub: snapshot.user.sub, email: snapshot.user.email } : undefined,
    login,
    logout,
    getToken,
  }), [snapshot, login, logout, getToken]);

  const mode = snapshot.status === 'signedOut' ? formMode(snapshot.setupRequired, snapshot.recoveryOpen) : 'login';

  return (
    <LocalAuthContext.Provider value={value}>
      {children}
      <Modal opened={formOpen && snapshot.status === 'signedOut'} onClose={() => setFormOpen(false)} title={FORM_TITLES[mode]} centered>
        {snapshot.status === 'signedOut' && (
          <Group justify="center" mb="md"><Logo height={48} /></Group>
        )}
        {snapshot.status === 'signedOut' && (
          <LocalAuthForm
            key={mode}
            setupRequired={snapshot.setupRequired}
            recoveryOpen={snapshot.recoveryOpen}
            onLogin={loginLocal}
            onSetup={setupLocal}
            onRecover={recoverLocal}
          />
        )}
      </Modal>
    </LocalAuthContext.Provider>
  );
}
