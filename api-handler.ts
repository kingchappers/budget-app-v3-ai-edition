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
    console.log('Received event:', JSON.stringify(event, null, 2));

    // Extract token from Authorization header
    const authHeader = event.headers?.authorization || '';
    console.log('Auth header:', authHeader);
    
    const token = authHeader.replace('Bearer ', '');

    if (!token) {
      console.log('No token found');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing authorization token' }),
      };
    }

    // Verify and decode JWT using Promise wrapper
    const decoded: any = await new Promise((resolve, reject) => {
      verify(token, getKey, { audience: AUTH0_AUDIENCE }, (err, decoded) => {
        if (err) {
          reject(err);
        } else {
          resolve(decoded);
        }
      });
    });

    // Route requests based on path
    const path = event.rawPath;
    console.log('Path:', path);

    if (path === '/api/test') {
      return handleTestEndpoint(decoded);
    }

    if (path === '/api/user-info') {
      return handleUserInfo(decoded);
    }

    // 404 for unknown endpoints
    return {
      statusCode: 404,
      body: JSON.stringify({ error: 'Endpoint not found' }),
    };
  } catch (error) {
    console.error('Unhandled error:', error);
    return {
      statusCode: 401,
      body: JSON.stringify({ 
        error: 'Unauthorized',
        details: error instanceof Error ? error.message : String(error)
      }),
    };
  }
};

function handleTestEndpoint(decoded: any) {
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userId: decoded.sub,
      email: decoded[`${AUTH0_DOMAIN}/email`] || decoded.email,
      name: decoded[`${AUTH0_DOMAIN}/name`] || decoded.name,
    }),
  };
}
