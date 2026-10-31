import type { ApiResponse } from '../api/types';
import { SECURITY_HEADERS } from '../api/constants';
import type { McpContext, McpTool } from './types';
import { toolAllowed } from './types';

export const MCP_MAX_BODY_BYTES = 65_536;
export const MCP_MAX_RESULT_CHARS = 200_000;

const SUPPORTED_VERSIONS = ['2025-06-18', '2025-03-26'];
const DEFAULT_VERSION = '2025-06-18';

const HEADERS: Record<string, string> = { ...SECURITY_HEADERS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

type RpcId = string | number | null;

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

function reply(body: object): ApiResponse {
  return { statusCode: 200, headers: HEADERS, body: JSON.stringify(body) };
}

function rpcError(id: RpcId, code: number, message: string): ApiResponse {
  return reply({ jsonrpc: '2.0', id, error: { code, message } });
}

function rpcResult(id: RpcId, result: object): ApiResponse {
  return reply({ jsonrpc: '2.0', id, result });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toolError(id: RpcId, message: string): ApiResponse {
  return rpcResult(id, { content: [{ type: 'text', text: message }], isError: true });
}

async function callTool(id: RpcId, params: unknown, context: McpContext, tools: McpTool[]): Promise<ApiResponse> {
  if (!isPlainObject(params) || typeof params.name !== 'string') {
    return rpcError(id, INVALID_PARAMS, 'Tool name is required.');
  }
  const args = params.arguments === undefined ? {} : params.arguments;
  if (!isPlainObject(args)) return rpcError(id, INVALID_PARAMS, 'Arguments must be an object.');

  const tool = tools.find((t) => t.name === params.name);
  if (!tool) return rpcError(id, INVALID_PARAMS, 'Unknown tool.');
  if (!toolAllowed(context.scope, tool.access)) {
    return rpcError(id, INVALID_PARAMS, 'That tool is not available to this connection.');
  }

  // Serialising is inside the try too, so a result JSON cannot hold is a tool error, not a 500.
  try {
    const outcome = await tool.run(args, context);
    if (!outcome.ok) return toolError(id, outcome.message);

    const text = JSON.stringify(outcome.data);
    if (text.length > MCP_MAX_RESULT_CHARS) {
      return toolError(id, 'That result is too large to return. Ask for a narrower request, such as a shorter date range.');
    }
    return rpcResult(id, { content: [{ type: 'text', text }], structuredContent: outcome.data });
  } catch (error) {
    // Name only: messages can carry the person's data.
    console.error('mcp tool failed', { tool: tool.name, error: error instanceof Error ? error.name : 'unknown' });
    return toolError(id, 'That request failed. Please try again.');
  }
}

export async function handleMcpBody(
  rawBody: string | undefined,
  context: McpContext,
  tools: McpTool[],
): Promise<ApiResponse> {
  if (rawBody !== undefined && Buffer.byteLength(rawBody, 'utf8') > MCP_MAX_BODY_BYTES) {
    return { statusCode: 413, headers: HEADERS, body: JSON.stringify({ error: 'Request body is too large.' }) };
  }

  let message: unknown;
  try {
    message = JSON.parse(rawBody ?? '');
  } catch {
    return rpcError(null, PARSE_ERROR, 'Invalid JSON.');
  }

  if (Array.isArray(message)) return rpcError(null, INVALID_REQUEST, 'Batch requests are not supported.');
  if (!isPlainObject(message)) return rpcError(null, INVALID_REQUEST, 'Request must be a JSON object.');

  const hasId = 'id' in message;
  const rawId = message.id;
  if (hasId && rawId !== null && typeof rawId !== 'string' && typeof rawId !== 'number') {
    return rpcError(null, INVALID_REQUEST, 'The id must be a string, a number or null.');
  }
  const id: RpcId = hasId ? (rawId as RpcId) : null;
  if (typeof message.method !== 'string') return rpcError(id, INVALID_REQUEST, 'The method must be a string.');

  // No id means a notification: acknowledged, never answered with a body.
  if (!hasId) return { statusCode: 202, headers: HEADERS, body: '' };

  switch (message.method) {
    case 'initialize': {
      const requested = isPlainObject(message.params) ? message.params.protocolVersion : undefined;
      const protocolVersion =
        typeof requested === 'string' && SUPPORTED_VERSIONS.includes(requested) ? requested : DEFAULT_VERSION;
      return rpcResult(id, {
        protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'hoardwise', version: '1.0.0' },
      });
    }
    case 'ping':
      return rpcResult(id, {});
    case 'tools/list':
      return rpcResult(id, {
        tools: tools
          .filter((t) => toolAllowed(context.scope, t.access))
          .map(({ name, title, description, inputSchema, annotations }) => ({
            name,
            title,
            description,
            inputSchema,
            annotations,
          })),
      });
    case 'tools/call':
      return callTool(id, message.params, context, tools);
    default:
      return rpcError(id, METHOD_NOT_FOUND, 'Method not found.');
  }
}
