export type DueLinkAction = 'add' | 'skip';

export interface DueLink {
  recurringId: string;
  period: string | null;
  action: DueLinkAction | null;
}

export const DUE_LINK_PARAMS = ['due', 'period', 'action'] as const;

const ID = /^[A-Za-z0-9-]{1,64}$/;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])(-(0[1-9]|[12]\d|3[01]))?$/;

// What a reminder's tap asks the app to do. Anything that does not look exactly like it was
// made by the app is ignored, so a crafted address can do nothing more than open Home (IO-08).
export function parseDueLink(params: URLSearchParams): DueLink | null {
  const recurringId = params.get('due');
  if (recurringId === null || !ID.test(recurringId)) return null;

  const period = params.get('period');
  const action = params.get('action');
  return {
    recurringId,
    period: period !== null && PERIOD.test(period) ? period : null,
    action: action === 'add' || action === 'skip' ? action : null,
  };
}

export function withoutDueLink(params: URLSearchParams): URLSearchParams {
  const next = new URLSearchParams(params);
  for (const name of DUE_LINK_PARAMS) next.delete(name);
  return next;
}
