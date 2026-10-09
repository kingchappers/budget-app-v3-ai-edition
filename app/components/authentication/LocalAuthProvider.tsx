import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Modal } from '@mantine/core';
import { LocalAuthContext } from '~/lib/auth';
import type { AuthState } from '~/lib/auth';
import { clearSessionEnded } from '~/lib/session';
import {
  ensureLocalAuth, getLocalAuthState, loginLocal, logoutLocal, setupLocal, subscribeLocalAuth,
} from '~/lib/localAuth';
import { LocalAuthForm } from './LocalAuthForm';

export function LocalAuthProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribeLocalAuth, getLocalAuthState, getLocalAuthState);
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => { void ensureLocalAuth(); }, []);
  useEffect(() => { if (snapshot.status === 'signedIn') clearSessionEnded(); }, [snapshot.status]);

  const login = useCallback(() => setFormOpen(true), []);
  const logout = useCallback(async () => {
    await logoutLocal();
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

  return (
    <LocalAuthContext.Provider value={value}>
      {children}
      <Modal opened={formOpen && snapshot.status === 'signedOut'} onClose={() => setFormOpen(false)} title="Sign in" centered>
        {snapshot.status === 'signedOut' && (
          <LocalAuthForm setupRequired={snapshot.setupRequired} onLogin={loginLocal} onSetup={setupLocal} />
        )}
      </Modal>
    </LocalAuthContext.Provider>
  );
}
