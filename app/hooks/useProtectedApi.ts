import { useAuth0 } from '@auth0/auth0-react';
import { useCallback } from 'react';
import { ApiError } from '~/lib/apiError';

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
          throw new ApiError(response.status, response.statusText);
        }

        if (response.status === 204) return null;
        const text = await response.text();
        return text ? JSON.parse(text) : null;
      } catch (error) {
        console.error('Protected API request failed:', error);
        throw error;
      }
    },
    [getAccessTokenSilently]
  );

  return { request };
}
