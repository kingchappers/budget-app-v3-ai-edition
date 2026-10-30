import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

export type OpenApiDocument = Record<string, any>;

export interface SpecOperation {
  method: string;
  template: string;
  operation: Record<string, unknown>;
}

const SPEC_PATH = resolve(__dirname, '../../../docs/openapi.yaml');
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];

export function loadSpec(): OpenApiDocument {
  return parse(readFileSync(SPEC_PATH, 'utf8')) as OpenApiDocument;
}

export function operations(spec: OpenApiDocument): SpecOperation[] {
  const paths: Record<string, Record<string, unknown>> = spec.paths ?? {};
  return Object.entries(paths).flatMap(([template, item]) =>
    HTTP_METHODS.filter((method) => item[method] !== undefined).map((method) => ({
      method: method.toUpperCase(),
      template,
      operation: item[method] as Record<string, unknown>,
    })),
  );
}

export interface RouteRef {
  method: string;
  template: string;
}

const routeKey = (route: RouteRef): string => `${route.method.toUpperCase()} ${route.template}`;

// Problems comparing the registered routes with the spec, each naming the offending route. Empty means parity.
export function routeParityProblems(registered: RouteRef[], spec: OpenApiDocument): string[] {
  const documented = new Set(operations(spec).map(routeKey));
  const registeredKeys = new Set(registered.map(routeKey));
  return [
    ...[...registeredKeys]
      .filter((key) => !documented.has(key))
      .map((key) => `registered but not in docs/openapi.yaml: ${key}`),
    ...[...documented]
      .filter((key) => !registeredKeys.has(key))
      .map((key) => `in docs/openapi.yaml but not registered: ${key}`),
  ];
}

export type TokenAccess = 'none' | 'read' | 'write';

// Problems with each operation's x-token-access, given the token router's routes and the token access rule.
export function tokenAccessProblems(
  tokenRoutes: RouteRef[],
  spec: OpenApiDocument,
  rejects: (scope: 'read', method: string, path: string) => boolean,
): string[] {
  const reachable = new Set(tokenRoutes.map(routeKey));
  return operations(spec).flatMap((op) => {
    const key = routeKey(op);
    const declared = op.operation['x-token-access'];
    if (!['none', 'read', 'write'].includes(declared as string)) {
      return [`${key}: x-token-access must be none, read or write, got ${String(declared)}`];
    }
    const path = op.template.replace(/\{(\w+)\}/g, '$1');
    let expected: TokenAccess = 'none';
    if (reachable.has(key)) expected = rejects('read', op.method, path) ? 'write' : 'read';
    return declared === expected ? [] : [`${key}: x-token-access is ${String(declared)}, expected ${expected}`];
  });
}
