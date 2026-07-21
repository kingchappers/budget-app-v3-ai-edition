import { verify } from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { createRouter } from './src/api/router';
import { SECURITY_HEADERS } from './src/api/constants';
import { getCategories, createCategory, deleteCategory } from './src/api/categories';
import { getTransactions, createTransaction, deleteTransaction } from './src/api/transactions';
import { getTargets, upsertTarget, deleteTarget } from './src/api/targets';

const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN || '';
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE || '';

const jwks = jwksClient({
  cache: true,
  cacheMaxAge: 600000,
  jwksUri: `https://${AUTH0_DOMAIN}/.well-known/jwks.json`,
});

function getKey(header: any, callback: any) {
  jwks.getSigningKey(header.kid, (err, key) => {
    if (err) callback(err);
    else callback(null, key?.getPublicKey());
  });
}

const router = createRouter();
router.get('/api/categories', getCategories);
router.post('/api/categories', createCategory);
router.delete('/api/categories/{categoryId}', deleteCategory);
router.get('/api/transactions', getTransactions);
router.post('/api/transactions', createTransaction);
router.delete('/api/transactions/{yearMonth}/{transactionId}', deleteTransaction);
router.get('/api/targets', getTargets);
router.put('/api/targets/{categoryId}', upsertTarget);
router.delete('/api/targets/{categoryId}', deleteTarget);

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  try {
    console.log('Request:', {
      path: event.rawPath,
      method: event.requestContext.http.method,
      sourceIp: event.requestContext.http.sourceIp,
    });

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

    const decoded: any = await new Promise((resolve, reject) => {
      verify(token, getKey, { audience: AUTH0_AUDIENCE, issuer: `https://${AUTH0_DOMAIN}/`, algorithms: ['RS256'] },
        (err, decoded) => err ? reject(err) : resolve(decoded),
      );
    });

    if (!decoded.sub || typeof decoded.sub !== 'string') {
      console.error('Auth failed: Invalid or missing sub claim');
      return { statusCode: 401, headers: SECURITY_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    return router.dispatch(event, decoded.sub);
  } catch (error) {
    console.error('Auth error:', error instanceof Error ? error.message : String(error));
    return { statusCode: 401, headers: SECURITY_HEADERS, body: JSON.stringify({ error: 'Unauthorized' }) };
  }
};
