import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { ApiResponse } from './types';
import { SECURITY_HEADERS } from './constants';

type Handler = (
  event: APIGatewayProxyEventV2,
  userId: string,
  params: Record<string, string>,
) => Promise<ApiResponse>;

interface Route {
  method: string;
  pattern: RegExp;
  paramNames: string[];
  handler: Handler;
}

export interface Router {
  get(path: string, handler: Handler): void;
  post(path: string, handler: Handler): void;
  put(path: string, handler: Handler): void;
  delete(path: string, handler: Handler): void;
  dispatch(event: APIGatewayProxyEventV2, userId: string): Promise<ApiResponse>;
}

export function createRouter(): Router {
  const routes: Route[] = [];

  function register(method: string, pathTemplate: string, handler: Handler): void {
    const paramNames: string[] = [];
    const regexStr = pathTemplate.replace(/\{(\w+)\}/g, (_, name) => {
      paramNames.push(name);
      return '([^/]+)';
    });
    routes.push({ method, pattern: new RegExp(`^${regexStr}$`), paramNames, handler });
  }

  async function dispatch(event: APIGatewayProxyEventV2, userId: string): Promise<ApiResponse> {
    const method = event.requestContext.http.method;
    const path = event.rawPath;

    for (const route of routes) {
      if (route.method !== method) continue;
      const match = path.match(route.pattern);
      if (!match) continue;

      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1];
      });

      return route.handler(event, userId, params);
    }

    return {
      statusCode: 404,
      headers: SECURITY_HEADERS,
      body: JSON.stringify({ error: 'Endpoint not found' }),
    };
  }

  return {
    get: (path, handler) => register('GET', path, handler),
    post: (path, handler) => register('POST', path, handler),
    put: (path, handler) => register('PUT', path, handler),
    delete: (path, handler) => register('DELETE', path, handler),
    dispatch,
  };
}
