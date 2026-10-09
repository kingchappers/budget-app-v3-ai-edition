import { useAuth } from '~/lib/auth';
import { useCallback } from 'react';
import { ApiError } from '~/lib/apiError';
import { expireLocalSession } from '~/lib/localAuth';
import { isSessionEndedError, markSessionEnded } from '~/lib/session';

export function useProtectedApi() {
  const { getToken, mode } = useAuth();

  const request = useCallback(
    async (endpoint: string, options: RequestInit = {}) => {
      try {
        const token = await getToken();

        const response = await fetch(endpoint, {
          ...options,
          headers: {
            ...options.headers,
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
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
        if (isSessionEndedError(error)) markSessionEnded();
        // In local mode a 401 means the server no longer knows this session (expired, or reset from the CLI).
        if (mode === 'local' && error instanceof ApiError && error.status === 401) {
          expireLocalSession();
          markSessionEnded();
        }
        throw error;
      }
    },
    [getToken, mode]
  );

  return { request };
}
