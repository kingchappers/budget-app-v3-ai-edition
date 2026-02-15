import { verify } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || '';
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || '';

// Create JWKS client to fetch Auth0's public keys
const client = jwksClient({
  cache: true,
  cacheMaxAge: 600000, // 10 minutes
  jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
});

// Synchronous wrapper for getKey that works with jwt.verify callback
function getKey(header: any, callback: any) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      callback(err);
    } else {
      callback(null, key?.getPublicKey());
    }
  });
}

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    // Log request info without sensitive data
    console.log('Request:', {
      path: event.rawPath,
      method: event.requestContext.http.method,
      sourceIp: event.requestContext.http.sourceIp,
    });

    // Extract token from Authorization header
    const authHeader = event.headers?.authorization || '';
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      console.log('Auth failed: No token provided');
      return {
        statusCode: 401,
        headers: SECURITY_HEADERS,
        body: JSON.stringify({ error: 'Missing authorization token' }),
      };
    }

    // Verify and decode JWT using Promise wrapper
    const decoded: any = await new Promise((resolve, reject) => {
      verify(
        token,
        getKey,
        {
          audience: AUTH0_AUDIENCE,
          issuer: `https://${AUTH0_DOMAIN}/`,
          algorithms: ['RS256'],
        },
        (err, decoded) => {
          if (err) {
            reject(err);
          } else {
            resolve(decoded);
          }
        }
      );
    });

    // Validate required JWT claims
    if (!decoded.sub || typeof decoded.sub !== 'string') {
      console.error('Auth failed: Invalid or missing sub claim');
      return {
        statusCode: 401,
        headers: SECURITY_HEADERS,
        body: JSON.stringify({ error: 'Unauthorized' }),
      };
    }

    // Route requests based on path
    const path = event.rawPath;

    if (path === '/api/test') {
      return handleTestEndpoint(decoded);
    }

    if (path === '/api/user-info') {
      return handleUserInfo(decoded);
    }

    // 404 for unknown endpoints
    return {
      statusCode: 404,
      headers: SECURITY_HEADERS,
      body: JSON.stringify({ error: 'Endpoint not found' }),
    };
  } catch (error) {
    // Log detailed error server-side only
    console.error('Auth error:', error instanceof Error ? error.message : String(error));
    // Return generic error to client
    return {
      statusCode: 401,
      headers: SECURITY_HEADERS,
      body: JSON.stringify({ error: 'Unauthorized' }),
    };
  }
};

// Security headers applied to all responses
const SECURITY_HEADERS = {
  'Content-Type': 'application/json',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': "default-src 'self'",
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function handleTestEndpoint(decoded: any) {
  return {
    statusCode: 200,
    headers: SECURITY_HEADERS,
    body: JSON.stringify({
      message: 'Hello from protected API',
      userId: decoded.sub,
      timestamp: new Date().toISOString(),
    }),
  };
}

function handleUserInfo(decoded: any) {
  return {
    statusCode: 200,
    headers: SECURITY_HEADERS,
    body: JSON.stringify({
      userId: decoded.sub,
      email: decoded[`${AUTH0_DOMAIN}/email`] || decoded.email,
      name: decoded[`${AUTH0_DOMAIN}/name`] || decoded.name,
    }),
  };
}
