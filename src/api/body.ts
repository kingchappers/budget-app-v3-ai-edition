import type { APIGatewayProxyEventV2 } from 'aws-lambda';

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function hasOnlyKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every(key => key in value) && Object.keys(value).every(key => allowed.has(key));
}

export function parseJsonBody(event: APIGatewayProxyEventV2): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(event.body || '{}');
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
