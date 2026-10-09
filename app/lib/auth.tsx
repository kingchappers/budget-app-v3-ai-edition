import { createContext, useCallback, useContext, useMemo } from 'react';
import { useAuth0 } from '@auth0/auth0-react';

export interface AuthUser {
  sub?: string;
  name?: string;
  email?: string;
  picture?: string;
}

export interface AuthState {
  mode: 'auth0' | 'local';
  isAuthenticated: boolean;
  isLoading: boolean;
  error?: Error;
  user?: AuthUser;
  login(): void | Promise<void>;
  logout(): void | Promise<void>;
  // A bearer token for Auth0; undefined in local mode, where the session cookie travels by itself.
  getToken(): Promise<string | undefined>;
}

export const LocalAuthContext = createContext<AuthState | null>(null);

export function useAuth(): AuthState {
  const local = useContext(LocalAuthContext);
  // Called unconditionally (hooks cannot be conditional). Without an Auth0Provider it is the library's inert default.
  const auth0 = useAuth0();

  const { loginWithRedirect, logout, getAccessTokenSilently } = auth0;
  const login = useCallback(() => loginWithRedirect(), [loginWithRedirect]);
  const signOut = useCallback(() => logout({ logoutParams: { returnTo: window.location.origin } }), [logout]);
  const getToken = useCallback(() => getAccessTokenSilently(), [getAccessTokenSilently]);

  const { isAuthenticated, isLoading, error, user } = auth0;
  const adapted = useMemo<AuthState>(
    () => ({ mode: 'auth0', isAuthenticated, isLoading, error, user, login, logout: signOut, getToken }),
    [isAuthenticated, isLoading, error, user, login, signOut, getToken],
  );

  return local ?? adapted;
}
