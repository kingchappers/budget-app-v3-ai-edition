export interface ApiSchema {
  $ref?: string;
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: ApiSchema;
  properties?: Record<string, ApiSchema>;
  required?: string[];
  anyOf?: ApiSchema[];
  oneOf?: ApiSchema[];
  minimum?: number;
  maximum?: number;
  example?: unknown;
  [key: string]: unknown;
}

export interface ApiParameter {
  name: string;
  in: string;
  required?: boolean;
  description?: string;
  schema?: ApiSchema;
  example?: unknown;
}

export interface ApiMediaType {
  schema?: ApiSchema;
  example?: unknown;
}

export interface ApiResponse {
  $ref?: string;
  description?: string;
  content?: Record<string, ApiMediaType>;
}

export interface ApiOperation {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  'x-token-access'?: 'none' | 'read' | 'write';
  parameters?: ApiParameter[];
  requestBody?: { required?: boolean; description?: string; content?: Record<string, ApiMediaType> };
  responses?: Record<string, ApiResponse>;
}

export interface ApiSpec {
  info?: { title?: string; description?: string; version?: string };
  tags?: { name: string; description?: string }[];
  paths?: Record<string, Partial<Record<string, ApiOperation>>>;
  components?: { schemas?: Record<string, ApiSchema>; responses?: Record<string, ApiResponse> };
}

export interface OperationEntry {
  method: string;
  path: string;
  operation: ApiOperation;
}

export interface OperationGroup {
  tag: string;
  description?: string;
  operations: OperationEntry[];
}

export interface FieldRow {
  name: string;
  type: string;
  required: boolean;
  description?: string;
  children?: FieldRow[];
}

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'];

export function groupOperationsByTag(spec: ApiSpec): OperationGroup[] {
  const entries: OperationEntry[] = Object.entries(spec.paths ?? {}).flatMap(([path, item]) =>
    HTTP_METHODS.flatMap((method) => {
      const operation = item[method];
      return operation ? [{ method: method.toUpperCase(), path, operation }] : [];
    }),
  );
  const declared = spec.tags ?? [];
  const known = new Set(declared.map((t) => t.name));
  const extra = [...new Set(entries.flatMap((e) => e.operation.tags ?? []))]
    .filter((name) => !known.has(name))
    .map((name) => ({ name, description: undefined as string | undefined }));
  return [...declared, ...extra]
    .map((tag) => ({
      tag: tag.name,
      description: tag.description,
      operations: entries.filter((e) => e.operation.tags?.includes(tag.name)),
    }))
    .filter((group) => group.operations.length > 0);
}

const REF_PREFIX = '#/components/schemas/';

export function resolveRef(spec: ApiSpec, schema: ApiSchema): ApiSchema {
  if (!schema.$ref) return schema;
  if (!schema.$ref.startsWith(REF_PREFIX)) throw new Error(`Unsupported reference ${schema.$ref}`);
  const target = spec.components?.schemas?.[schema.$ref.slice(REF_PREFIX.length)];
  if (!target) throw new Error(`Unknown reference ${schema.$ref}`);
  return target;
}

function refName(schema: ApiSchema): string | undefined {
  return schema.$ref?.startsWith(REF_PREFIX) ? schema.$ref.slice(REF_PREFIX.length) : undefined;
}

function typeLabel(spec: ApiSpec, schema: ApiSchema): string {
  const resolved = resolveRef(spec, schema);
  if (resolved.enum) return `one of: ${resolved.enum.map(String).join(', ')}`;
  const alternatives = resolved.anyOf ?? resolved.oneOf;
  if (alternatives) return `one of: ${alternatives.map((alt) => typeLabel(spec, alt)).join(', ')}`;
  if (Array.isArray(resolved.type)) return resolved.type.join(' or ');
  if (resolved.type === 'array') {
    const item = resolved.items;
    if (!item) return 'array';
    const named = refName(item);
    const itemResolved = resolveRef(spec, item);
    return `array of ${named && itemResolved.type === 'object' ? named : typeLabel(spec, item)}`;
  }
  if (resolved.type === 'object') return refName(schema) ?? 'object';
  return resolved.type ?? 'any';
}

function objectOf(spec: ApiSpec, schema: ApiSchema): ApiSchema | undefined {
  const resolved = resolveRef(spec, schema);
  if (resolved.properties) return resolved;
  if (resolved.type === 'array' && resolved.items) return objectOf(spec, resolved.items);
  return undefined;
}

export function schemaFields(spec: ApiSpec, schema: ApiSchema, depth: number = 2): FieldRow[] {
  const object = objectOf(spec, schema);
  if (!object?.properties) return [];
  const required = new Set(object.required ?? []);
  return Object.entries(object.properties).map(([name, property]) => {
    const row: FieldRow = {
      name,
      type: typeLabel(spec, property),
      required: required.has(name),
      description: property.description ?? resolveRef(spec, property).description,
    };
    if (depth > 0) {
      const children = schemaFields(spec, property, depth - 1);
      if (children.length > 0) row.children = children;
    }
    return row;
  });
}

export function exampleCurl(opts: { method: string; path: string; body?: unknown }): string {
  const method = opts.method.toUpperCase();
  const url = `"$HOARDWISE_URL${opts.path}"`;
  const auth = '-H "Authorization: Bearer $HOARDWISE_TOKEN"';
  const verb = method === 'GET' ? '' : ` -X ${method}`;
  if (opts.body === undefined) {
    return `curl -sS${verb} ${auth} ${url}`;
  }
  return [
    'body=$(mktemp) && echo "$body"   # write the JSON body to exactly that path, then:',
    `curl -sS${verb} ${auth} -H "Content-Type: application/json" \\`,
    `  --data @"$body" ${url}`,
    'rm -f "$body"',
  ].join('\n');
}

export function filterOperations(groups: OperationGroup[], query: string): OperationGroup[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return groups;
  return groups.flatMap((group) => {
    if (group.tag.toLowerCase().includes(needle)) return [group];
    const operations = group.operations.filter(
      (e) => e.path.toLowerCase().includes(needle) || (e.operation.summary ?? '').toLowerCase().includes(needle),
    );
    return operations.length > 0 ? [{ ...group, operations }] : [];
  });
}

const CODE_SPAN = /`[^`\n]+`/g;

const UNSUPPORTED_MARKDOWN: { name: string; pattern: RegExp }[] = [
  { name: 'bold (**)', pattern: /\*\*/ },
  { name: 'bold (__)', pattern: /__/ },
  { name: 'link [text](url)', pattern: /\[[^\]]*\]\(/ },
  { name: 'heading other than ##', pattern: /^\s{0,3}(#|#{3,6})\s/m },
  { name: 'fenced code block', pattern: /^\s*(```|~~~)/m },
  { name: 'table row', pattern: /^\s*\|.*\|/m },
  { name: 'raw tag', pattern: /<\/?[a-zA-Z][^>]*>/ },
  { name: 'numbered list', pattern: /^\s*\d+[.)]\s/m },
];

export function findUnsupportedMarkdown(text: string): string[] {
  const withoutCode = text.replace(CODE_SPAN, '');
  return UNSUPPORTED_MARKDOWN.filter((u) => u.pattern.test(withoutCode)).map((u) => u.name);
}
