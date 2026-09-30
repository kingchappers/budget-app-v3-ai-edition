import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { Loader } from '@mantine/core';
import LoginButton from './LoginButton';
import { Profile } from './Profile';

function Authentication() {
  const { isAuthenticated, isLoading, error } = useAuth0();

  useEffect(() => {
    if (error) console.error('Authentication: Auth0 reported an error', error);
  }, [error]);

  if (isLoading) return <Loader size="sm" aria-label="Checking your session" />;
  if (isAuthenticated) return <Profile />;
  return <LoginButton />;
}

export default Authentication;
