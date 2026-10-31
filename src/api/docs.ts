import type { Router } from './router';
import { SECURITY_HEADERS } from './constants';
import openApiSpec from './generated/openapi.json';
import { AGENT_DOCS_MARKDOWN } from './generated/agentDocs';
import type { ApiResponse } from './types';

const OPENAPI_JSON = JSON.stringify(openApiSpec);
const PRIVATE_HEADERS: Record<string, string> = { ...SECURITY_HEADERS, 'Cache-Control': 'private' };

export async function getOpenApiSpec(): Promise<ApiResponse> {
  return { statusCode: 200, headers: PRIVATE_HEADERS, body: OPENAPI_JSON };
}

export async function getAgentDocs(): Promise<ApiResponse> {
  return {
    statusCode: 200,
    headers: { ...PRIVATE_HEADERS, 'Content-Type': 'text/markdown; charset=utf-8' },
    body: AGENT_DOCS_MARKDOWN,
  };
}

// Kept out of registerCoreRoutes so the browser demo's public bundle never contains the spec.
export function registerDocsRoutes(router: Router): void {
  router.get('/api/openapi.json', getOpenApiSpec);
  router.get('/api/docs/agents', getAgentDocs);
}
