import { SECURITY_HEADERS } from './constants';
import type { ApiResponse } from './types';

export function ok(body: object): ApiResponse {
  return { statusCode: 200, headers: SECURITY_HEADERS, body: JSON.stringify(body) };
}

export function err(status: number, message: string): ApiResponse {
  return { statusCode: status, headers: SECURITY_HEADERS, body: JSON.stringify({ error: message }) };
}
