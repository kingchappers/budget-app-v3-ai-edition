export type ProviderErrorType = 'EXPIRED' | 'RATE_LIMITED' | 'TRANSIENT' | 'INVALID_RESPONSE';

export class ProviderError extends Error {
  readonly type: ProviderErrorType;

  constructor(type: ProviderErrorType, message: string) {
    super(message);
    this.name = 'ProviderError';
    this.type = type;
  }
}

export function classifyHttpStatus(status: number): ProviderErrorType {
  if (status === 401 || status === 403) return 'EXPIRED';
  if (status === 429) return 'RATE_LIMITED';
  if (status >= 500) return 'TRANSIENT';
  return 'INVALID_RESPONSE';
}

export function classifyProviderError(error: unknown): ProviderErrorType {
  return error instanceof ProviderError ? error.type : 'TRANSIENT';
}
