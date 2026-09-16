export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, statusText: string) {
    super(`API error: ${status} ${statusText}`);
    this.name = 'ApiError';
    this.status = status;
  }
}
