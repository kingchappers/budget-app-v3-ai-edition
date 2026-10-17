import type { APIGatewayProxyHandlerV2 } from 'aws-lambda';
import { createRouter } from './src/api/router';
import { initStore } from './src/store';
import { initAuth } from './src/auth';
import { SECURITY_HEADERS } from './src/api/constants';
import { registerCoreRoutes } from './src/api/routes';
import { createPushSubscription, deletePushSubscription } from './src/api/push';

const router = createRouter();
registerCoreRoutes(router);
router.post('/api/push/subscriptions', createPushSubscription);
router.delete('/api/push/subscriptions', deletePushSubscription);

const INTERNAL_ERROR = JSON.stringify({ error: 'Internal server error' });

export const handler: APIGatewayProxyHandlerV2 = async (event) => {
  console.log('Request:', {
    // Log the templated route, not the raw path — path segments can carry
    // resource IDs that the spec's Logging section says must never be logged.
    route: event.requestContext.routeKey,
    method: event.requestContext.http.method,
    sourceIp: event.requestContext.http.sourceIp,
  });

  // A failure inside a handler is the server's, not an authentication failure, so it is kept apart
  // from the 401s below and answered with a generic body; the detail goes to the logs only.
  try {
    const auth = await initAuth();
    const publicResponse = await auth.handlePublic?.(event);
    if (publicResponse) return publicResponse;

    const result = await auth.authenticate(event);
    if ('rejection' in result) return result.rejection;

    await initStore();
    return await router.dispatch(event, result.userId);
  } catch (error) {
    console.error(`Unhandled error in ${event.requestContext.routeKey}:`, error instanceof Error ? error.message : String(error));
    return { statusCode: 500, headers: SECURITY_HEADERS, body: INTERNAL_ERROR };
  }
};
