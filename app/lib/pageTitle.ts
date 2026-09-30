export const APP_NAME = 'Budget';

export function pageTitle(...parts: string[]): string {
  return [...parts.filter(part => part !== ''), APP_NAME].join(' – ');
}
