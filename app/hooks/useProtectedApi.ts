import { useAuth0 } from '@auth0/auth0-react';
import { useCallback } from 'react';

export function useProtectedApi() {
  const { getAccessTokenSilently } = useAuth0();

  const request = useCallback(
    async (endpoint: string, options: RequestInit = {}) => {
      try {
        const token = await getAccessTokenSilently();

        const response = await fetch(endpoint, {
          ...options,
          headers: {
            ...options.headers,
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status} ${response.statusText}`);
        }

        return await response.json();
      } catch (error) {
        console.error('Protected API request failed:', error);
        throw error;
      }
    },
    [getAccessTokenSilently]
  );

  return { request };
}
