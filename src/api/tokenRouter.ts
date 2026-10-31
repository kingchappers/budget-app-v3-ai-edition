import { createRouter } from './router';
import type { Router } from './router';
import { registerDocsRoutes } from './docs';
import { registerCoreRoutes } from './routes';

// The allow-list for access tokens: the budget routes and the read-only API docs. A route added to the main router
// alone stays out of reach of tokens until it is registered here too.
export function createTokenRouter(router: Router = createRouter()): Router {
  registerCoreRoutes(router);
  registerDocsRoutes(router);
  return router;
}
