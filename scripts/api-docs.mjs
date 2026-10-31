import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';

const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'patch'];
const MAX_NESTED_LEVELS = 2;

export function specToJson(spec) {
  return `${JSON.stringify(spec, null, 2)}\n`;
}

function resolveRef(spec, node) {
  let current = node;
  while (current && typeof current === 'object' && typeof current.$ref === 'string') {
    const target = current.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((acc, key) => acc?.[key], spec);
    // A sibling description (allowed beside $ref in 3.1) wins over the target's.
    current = current.description && target ? { ...target, description: current.description } : target;
  }
  return current ?? {};
}

function shortType(spec, schema) {
  const node = resolveRef(spec, schema);
  const branches = node.oneOf ?? node.anyOf ?? node.allOf;
  if (branches) {
    const types = [...new Set(branches.map((branch) => shortType(spec, branch)))];
    return types.length === 1 ? types[0] : `one of: ${types.join(', ')}`;
  }
  const type = Array.isArray(node.type) ? node.type.join('|') : node.type;
  if (node.enum) return `${type ?? 'string'} (${node.enum.map((value) => (value === null ? 'null' : value)).join('|')})`;
  if (node.type === 'array') return `array of ${shortType(spec, node.items ?? {})}`;
  if (node.type === 'object' || node.properties) return 'object';
  return type ?? 'any';
}

function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

// First sentence, ignoring full stops inside backticks or parentheses.
function firstSentence(text) {
  const flat = oneLine(text);
  let inCode = false;
  let depth = 0;
  for (let i = 0; i < flat.length; i += 1) {
    const char = flat[i];
    if (char === '`') inCode = !inCode;
    else if (!inCode && char === '(') depth += 1;
    else if (!inCode && char === ')') depth = Math.max(0, depth - 1);
    else if (!inCode && depth === 0 && '.!?'.includes(char) && (i + 1 === flat.length || flat[i + 1] === ' ')) {
      return flat.slice(0, i + 1);
    }
  }
  return flat;
}

function fieldLines(spec, schema, depth) {
  const node = resolveRef(spec, schema);
  const properties = node.properties ?? {};
  const required = new Set(node.required ?? []);
  return Object.entries(properties).flatMap(([name, property]) => {
    const resolved = resolveRef(spec, property);
    const description = firstSentence(resolved.description);
    const head = `${'  '.repeat(depth)}- \`${name}\` (${shortType(spec, property)}, ${required.has(name) ? 'required' : 'optional'})`;
    const lines = [description ? `${head}: ${description}` : head];
    const nested = resolved.type === 'array' ? resolveRef(spec, resolved.items ?? {}) : resolved;
    if (depth < MAX_NESTED_LEVELS && nested.properties) {
      lines.push(...fieldLines(spec, nested, depth + 1));
    }
    return lines;
  });
}

function renderOperation(spec, method, template, pathItem, operation) {
  const lines = [`### ${method.toUpperCase()} ${template}`, ''];
  if (operation.summary) lines.push(oneLine(operation.summary), '');
  lines.push(`Token access: ${operation['x-token-access'] ?? 'none'}`, '');

  const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map((p) => resolveRef(spec, p));
  if (parameters.length > 0) {
    lines.push('Parameters:');
    for (const parameter of parameters) {
      const requirement = parameter.required ? 'required' : 'optional';
      const description = firstSentence(parameter.description);
      const head = `- \`${parameter.name}\` (${parameter.in}, ${requirement}): ${shortType(spec, parameter.schema ?? {})}`;
      lines.push(description ? `${head}. ${description}` : head);
    }
    lines.push('');
  }

  const bodySchema = resolveRef(spec, operation.requestBody).content?.['application/json']?.schema;
  if (bodySchema) {
    const fields = fieldLines(spec, bodySchema, 0);
    lines.push('Request body (JSON):', ...(fields.length > 0 ? fields : [`- ${shortType(spec, bodySchema)}`]), '');
  }

  const responses = Object.entries(operation.responses ?? {});
  if (responses.length > 0) {
    lines.push('Responses:');
    for (const [status, response] of responses) {
      lines.push(`- ${status}: ${oneLine(resolveRef(spec, response).description)}`);
    }
    lines.push('');
  }
  return lines;
}

export function renderAgentDocs(spec) {
  const lines = [`# ${spec.info.title}`, '', String(spec.info.description ?? '').trim(), ''];
  const paths = Object.entries(spec.paths ?? {});
  for (const tag of spec.tags ?? []) {
    lines.push(`## ${tag.name}`, '');
    if (tag.description) lines.push(oneLine(tag.description), '');
    for (const [template, pathItem] of paths) {
      for (const method of HTTP_METHODS) {
        const operation = pathItem[method];
        if (operation?.tags?.includes(tag.name)) {
          lines.push(...renderOperation(spec, method, template, pathItem, operation));
        }
      }
    }
  }
  return `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`;
}

export function renderAgentDocsModule(markdown) {
  return [
    '// Generated by scripts/generate-api-docs.mjs from docs/openapi.yaml. Do not edit; run `yarn docs:generate`.',
    `export const AGENT_DOCS_MARKDOWN = ${JSON.stringify(markdown)};`,
    '',
  ].join('\n');
}

export function generate(root) {
  const spec = parse(readFileSync(resolve(root, 'docs/openapi.yaml'), 'utf8'));
  return [
    { path: 'src/api/generated/openapi.json', content: specToJson(spec) },
    { path: 'src/api/generated/agentDocs.ts', content: renderAgentDocsModule(renderAgentDocs(spec)) },
  ];
}
