import type { TokenScope } from '../auth/tokens';

export type ToolAccess = 'read' | 'styles' | 'budget';

export interface McpContext {
  userId: string;
  scope: TokenScope;
  now: Date;
}

export type ToolOutcome = { ok: true; data: Record<string, unknown> } | { ok: false; message: string };

export interface McpTool {
  name: string;
  title: string;
  description: string;
  access: ToolAccess;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: false;
  };
  run(args: Record<string, unknown>, context: McpContext): Promise<ToolOutcome>;
}

export function toolAllowed(scope: TokenScope, access: ToolAccess): boolean {
  if (scope === 'write') return true;
  return access === 'read' || access === 'styles';
}
