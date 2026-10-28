export const APP_NAME = 'Hoardwise';
export const SITE_URL = 'https://hoardwise.xyz';
export const APP_DESCRIPTION = 'A calm way to keep track of your money.';

export function pageTitle(...parts: string[]): string {
  return [...parts.filter(part => part !== ''), APP_NAME].join(' – ');
}
