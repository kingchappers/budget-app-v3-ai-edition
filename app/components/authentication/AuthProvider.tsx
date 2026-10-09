import { useEffect, useState } from 'react';
import { Auth0Provider } from '@auth0/auth0-react';
import { Center, Loader, Text } from '@mantine/core';
import { getRuntimeConfig } from '~/lib/runtimeConfig';
import type { RuntimeConfig } from '~/lib/runtimeConfig';
import { LocalAuthProvider } from './LocalAuthProvider';

type Loaded = { status: 'loading' } | { status: 'error' } | { status: 'ready'; config: RuntimeConfig };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [loaded, setLoaded] = useState<Loaded>({ status: 'loading' });

  useEffect(() => {
    let cancelled = false;
    getRuntimeConfig().then(
      config => { if (!cancelled) setLoaded({ status: 'ready', config }); },
      (error: unknown) => {
        console.error('Could not load the app configuration:', error);
        if (!cancelled) setLoaded({ status: 'error' });
      },
    );
    return () => { cancelled = true; };
  }, []);

  if (loaded.status === 'loading') {
    return <Center mih="100vh"><Loader aria-label="Starting the app" /></Center>;
  }
  if (loaded.status === 'error') {
    return <Center mih="100vh" p="md"><Text>The app could not start because its configuration did not load. Check your connection and reload.</Text></Center>;
  }

  const { config } = loaded;
  if (config.auth === 'local') return <LocalAuthProvider>{children}</LocalAuthProvider>;

  return (
    <Auth0Provider
      domain={config.domain}
      clientId={config.clientId}
      // The default in-memory cache forces a silent-auth iframe on every reload,
      // which browsers block as a third-party cookie. Persist instead and renew
      // with a rotating refresh token.
      cacheLocation="localstorage"
      useRefreshTokens
      useRefreshTokensFallback={false}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: config.audience,
        scope: 'openid profile email offline_access',
      }}
    >
      {children}
    </Auth0Provider>
  );
}
