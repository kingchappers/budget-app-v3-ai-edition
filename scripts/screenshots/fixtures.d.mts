export function referenceNow(real?: Date): Date;

export interface FixtureReply {
  status: number;
  json: unknown;
}

export function createStore(now?: Date): {
  handle(method: string, pathname: string, params: URLSearchParams, body?: Record<string, unknown>): FixtureReply;
};
