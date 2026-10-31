import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleMcpBody, MCP_MAX_BODY_BYTES, MCP_MAX_RESULT_CHARS } from '../protocol';
import type { McpContext, McpTool, ToolOutcome } from '../types';
import { toolAllowed } from '../types';

const readContext: McpContext = { userId: 'u1', scope: 'read', now: new Date('2026-10-31T12:00:00Z') };
const writeContext: McpContext = { ...readContext, scope: 'write' };

function fakeTool(overrides: Partial<McpTool> = {}): McpTool {
  return {
    name: 'echo',
    title: 'Echo',
    description: 'Echoes its input.',
    access: 'read',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    run: async (args): Promise<ToolOutcome> => ({ ok: true, data: { echoed: args } }),
    ...overrides,
  };
}

async function rpc(message: unknown, context = readContext, tools: McpTool[] = [fakeTool()]) {
  const res = await handleMcpBody(JSON.stringify(message), context, tools);
  return { res, json: res.body ? JSON.parse(res.body) : undefined };
}

afterEach(() => vi.restoreAllMocks());

describe('toolAllowed', () => {
  it('lets read scope use read and styles but not budget', () => {
    expect(toolAllowed('read', 'read')).toBe(true);
    expect(toolAllowed('read', 'styles')).toBe(true);
    expect(toolAllowed('read', 'budget')).toBe(false);
  });
  it('lets write scope use everything', () => {
    expect(toolAllowed('write', 'budget')).toBe(true);
  });
});

describe('initialize', () => {
  const init = (version: string) => rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: version } });

  it('returns capabilities and server info', async () => {
    const { res, json } = await init('2025-06-18');
    expect(res.statusCode).toBe(200);
    expect(json.result.capabilities).toEqual({ tools: {} });
    expect(json.result.serverInfo.name).toBe('hoardwise');
  });
  it('echoes a supported client version', async () => {
    const { json } = await init('2025-03-26');
    expect(json.result.protocolVersion).toBe('2025-03-26');
  });
  it('answers 2025-06-18 to an unsupported version', async () => {
    const { json } = await init('1999-01-01');
    expect(json.result.protocolVersion).toBe('2025-06-18');
  });
  it('replies as JSON with no-store and security headers', async () => {
    const { res } = await init('2025-06-18');
    expect(res.headers['Content-Type']).toBe('application/json');
    expect(res.headers['Cache-Control']).toBe('no-store');
    expect(res.headers['X-Content-Type-Options']).toBe('nosniff');
  });
});

describe('simple methods', () => {
  it('answers notifications/initialized with 202 and an empty body', async () => {
    const res = await handleMcpBody(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), readContext, []);
    expect(res.statusCode).toBe(202);
    expect(res.body).toBe('');
  });
  it('answers ping with an empty result', async () => {
    const { json } = await rpc({ jsonrpc: '2.0', id: 'a', method: 'ping' });
    expect(json).toEqual({ jsonrpc: '2.0', id: 'a', result: {} });
  });
});

describe('tools/list', () => {
  it('returns name, title, description, inputSchema and annotations', async () => {
    const tool = fakeTool();
    const { json } = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    expect(json.result.tools).toEqual([
      {
        name: tool.name,
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: tool.annotations,
      },
    ]);
  });
  it('hides tools the scope may not call', async () => {
    const tools = [fakeTool(), fakeTool({ name: 'spend', access: 'budget' })];
    const { json } = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, readContext, tools);
    expect(json.result.tools.map((t: { name: string }) => t.name)).toEqual(['echo']);
  });
  it('shows budget tools to write scope', async () => {
    const tools = [fakeTool(), fakeTool({ name: 'spend', access: 'budget' })];
    const { json } = await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/list' }, writeContext, tools);
    expect(json.result.tools).toHaveLength(2);
  });
});

describe('tools/call', () => {
  const call = (params: unknown, context = readContext, tools?: McpTool[]) =>
    rpc({ jsonrpc: '2.0', id: 7, method: 'tools/call', params }, context, tools);

  it('returns text content plus structuredContent', async () => {
    const { json } = await call({ name: 'echo', arguments: { a: 1 } });
    const data = { echoed: { a: 1 } };
    expect(json.result.content).toEqual([{ type: 'text', text: JSON.stringify(data) }]);
    expect(json.result.structuredContent).toEqual(data);
    expect(json.result.isError).toBeUndefined();
  });
  it('passes the context to the tool and defaults arguments to {}', async () => {
    const run = vi.fn(async (): Promise<ToolOutcome> => ({ ok: true, data: {} }));
    await call({ name: 'echo' }, readContext, [fakeTool({ run })]);
    expect(run).toHaveBeenCalledWith({}, readContext);
  });
  it('answers an unknown tool with -32602', async () => {
    const { res, json } = await call({ name: 'nope' });
    expect(res.statusCode).toBe(200);
    expect(json.error.code).toBe(-32602);
  });
  it('answers a tool the scope may not use with -32602', async () => {
    const { json } = await call({ name: 'spend' }, readContext, [fakeTool({ name: 'spend', access: 'budget' })]);
    expect(json.error.code).toBe(-32602);
    expect(json.error.message).toContain('not available to this connection');
  });
  it('answers wrong-typed arguments with -32602', async () => {
    for (const args of ['x', 5, [1], null]) {
      const { res, json } = await call({ name: 'echo', arguments: args });
      expect(res.statusCode).toBe(200);
      expect(json.error.code).toBe(-32602);
    }
  });
  it('answers missing or non-object params with -32602', async () => {
    for (const params of [undefined, 'x', [], { name: 5 }]) {
      const { json } = await call(params);
      expect(json.error.code).toBe(-32602);
    }
  });
  it('turns a failed outcome into isError with the message only', async () => {
    const tool = fakeTool({ run: async () => ({ ok: false, message: 'Month must be YYYY-MM.' }) });
    const { json } = await call({ name: 'echo' }, readContext, [tool]);
    expect(json.result.isError).toBe(true);
    expect(json.result.content).toEqual([{ type: 'text', text: 'Month must be YYYY-MM.' }]);
    expect(JSON.stringify(json)).not.toContain('stack');
  });
  it('turns a throw into isError and logs only the tool name', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const tool = fakeTool({
      run: async () => {
        throw new TypeError('secret payee Acme');
      },
    });
    const { json } = await call({ name: 'echo', arguments: { q: 'private' } }, readContext, [tool]);
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toContain('That request failed');
    expect(json.result.content[0].text).not.toContain('Acme');
    const logged = JSON.stringify(spy.mock.calls);
    expect(logged).toContain('echo');
    expect(logged).not.toContain('Acme');
    expect(logged).not.toContain('private');
  });
  it('turns an oversized result into isError asking for a narrower request', async () => {
    const tool = fakeTool({ run: async () => ({ ok: true, data: { big: 'x'.repeat(MCP_MAX_RESULT_CHARS) } }) });
    const { json } = await call({ name: 'echo' }, readContext, [tool]);
    expect(json.result.isError).toBe(true);
    expect(json.result.content[0].text).toContain('narrower');
    expect(json.result.structuredContent).toBeUndefined();
  });
});

describe('malformed JSON-RPC', () => {
  const raw = (body: string | undefined) => handleMcpBody(body, readContext, [fakeTool()]);

  it('answers invalid JSON with -32700', async () => {
    const res = await raw('{nope');
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).error.code).toBe(-32700);
  });
  it('answers a missing body with -32700', async () => {
    expect(JSON.parse((await raw(undefined)).body).error.code).toBe(-32700);
  });
  it('refuses a batch with -32600', async () => {
    const res = await raw(JSON.stringify([{ jsonrpc: '2.0', id: 1, method: 'ping' }]));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).error.code).toBe(-32600);
  });
  it('refuses a non-object body with -32600', async () => {
    expect(JSON.parse((await raw('5')).body).error.code).toBe(-32600);
  });
  it('refuses a missing method with -32600', async () => {
    expect(JSON.parse((await raw(JSON.stringify({ jsonrpc: '2.0', id: 1 }))).body).error.code).toBe(-32600);
  });
  it('refuses a non-string method with -32600', async () => {
    expect(JSON.parse((await raw(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 5 }))).body).error.code).toBe(-32600);
  });
  it('refuses an object id with -32600 and a null id in the reply', async () => {
    const body = JSON.parse((await raw(JSON.stringify({ jsonrpc: '2.0', id: {}, method: 'ping' }))).body);
    expect(body.error.code).toBe(-32600);
    expect(body.id).toBeNull();
  });
  it('answers an unknown method with -32601', async () => {
    const body = JSON.parse((await raw(JSON.stringify({ jsonrpc: '2.0', id: 3, method: 'bogus' }))).body);
    expect(body.error.code).toBe(-32601);
    expect(body.id).toBe(3);
  });
  it('answers 413 beyond the body limit', async () => {
    const res = await raw(' '.repeat(MCP_MAX_BODY_BYTES + 1));
    expect(res.statusCode).toBe(413);
  });
});
