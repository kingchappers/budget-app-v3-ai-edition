import { verify } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { SECURITY_HEADERS } from '../api/constants';
import type { ApiResponse } from '../api/types';
import type { AuthProvider } from './types';

function unauthorized(message = 'Unauthorized'): { rejection: ApiResponse } {
  return { rejection: { statusCode: 401, headers: SECURITY_HEADERS, body: JSON.stringify({ error: message }) } };
}

export function createAuth0Provider(env: NodeJS.ProcessEnv): AuthProvider {
  const domain = env.AUTH0_DOMAIN || '';
  const audience = env.AUTH0_AUDIENCE || '';

  const jwks = jwksClient({
    cache: true,
    cacheMaxAge: 600000,
    jwksUri: `https://${domain}/.well-known/jwks.json`,
  });

  function getKey(header: any, callback: any) {
    jwks.getSigningKey(header.kid, (err, key) => {
      if (err) callback(err);
      else callback(null, key?.getPublicKey());
    });
  }

  return {
    async authenticate(event) {
      const authHeader = event.headers?.authorization || '';
      const token = authHeader.replace('Bearer ', '');

      if (!token) {
        console.log('Auth failed: No token provided');
        return unauthorized('Missing authorization token');
      }

      try {
        const decoded: any = await new Promise((resolve, reject) => {
          verify(token, getKey, { audience, issuer: `https://${domain}/`, algorithms: ['RS256'] },
            (err, decoded) => err ? reject(err) : resolve(decoded),
          );
        });

        if (!decoded.sub || typeof decoded.sub !== 'string') {
          console.error('Auth failed: Invalid or missing sub claim');
          return unauthorized();
        }
        return { userId: decoded.sub };
      } catch (error) {
        console.error('Auth error:', error instanceof Error ? error.message : String(error));
        return unauthorized();
      }
    },
  };
}
