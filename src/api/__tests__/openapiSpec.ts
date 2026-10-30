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
