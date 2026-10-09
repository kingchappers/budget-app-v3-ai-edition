// The screenshots on the About page. The page and scripts/screenshots/capture.mjs both read this list,
// so a renamed shot fails a test instead of leaving a broken image on a public page. Keep this file free
// of imports: Node loads it directly.

export type ShotId = 'home' | 'add' | 'transactions' | 'plan' | 'insights' | 'recurring' | 'settings';
export type ShotSize = 'phone' | 'desktop';
export type ShotScheme = 'light' | 'dark';

export interface Shot {
  id: ShotId;
  route: string;
  heading: string;
  caption: string;
  howTo: string;
  alt: string;
}

export const SHOTS: readonly Shot[] = [
  {
    id: 'home',
    route: '/',
    heading: 'Home',
    caption: 'How much you have left to spend this month, and what is coming up.',
    howTo: 'Open the app and the answer is the first thing you see.',
    alt: 'The Home page showing money left to spend this month and an upcoming bill',
  },
  {
    id: 'add',
    route: '/',
    heading: 'Add something you bought',
    caption: 'Type an amount, choose a category and save. Most days that is all you need.',
    howTo: 'Tap Add, or press N on a keyboard. You can undo straight away.',
    alt: 'The Add transaction sheet with an amount typed and a category chosen',
  },
  {
    id: 'transactions',
    route: '/transactions',
    heading: 'Transactions',
    caption: 'Everything you have added, newest first, with filters when you need to find something.',
    howTo: 'Tap any row to change it or delete it. Deleted items can be brought back.',
    alt: 'The Transactions page listing a month of purchases grouped by day',
  },
  {
    id: 'plan',
    route: '/plan?tab=pots',
    heading: 'Plan: budgets and pots',
    caption: 'A budget is the most you plan to spend on a category. A pot is money kept apart for something.',
    howTo: 'Both are optional. Find them under Plan.',
    alt: 'The Plan page on its Pots tab, showing two savings pots with their balances and goals',
  },
  {
    id: 'insights',
    route: '/insights',
    heading: 'Insights',
    caption: 'Where your money went, how this month compares, and how your savings are growing.',
    howTo: 'Use the month arrows to look back, and open a section for the detail.',
    alt: 'The Insights page with spending broken down by group and a six-month trend chart',
  },
  {
    id: 'recurring',
    route: '/plan?tab=recurring',
    heading: 'Recurring bills',
    caption: 'Add a bill once and the app shows it on Home when it is due.',
    howTo: 'Nothing is added until you confirm it with one tap.',
    alt: 'The Recurring tab listing a mortgage and a streaming subscription with their due days',
  },
  {
    id: 'settings',
    route: '/settings',
    heading: 'Settings',
    caption: 'Text size, appearance, reminders and the shortcut keys, kept on your own device.',
    howTo: 'Open the cog in the top bar.',
    alt: 'The Settings page with display options and links to categories and accounts',
  },
];

export const SIZES: Record<ShotSize, { width: number; height: number }> = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1280, height: 800 },
};

export const SCHEMES: readonly ShotScheme[] = ['light', 'dark'];

export function shotFileName(id: ShotId, size: ShotSize, scheme: ShotScheme): string {
  return `${id}-${size}-${scheme}.webp`;
}

export function shotUrl(id: ShotId, size: ShotSize, scheme: ShotScheme): string {
  return `/about/${shotFileName(id, size, scheme)}`;
}

export function allShotFileNames(): string[] {
  const sizes = Object.keys(SIZES) as ShotSize[];
  return SHOTS.flatMap(shot => sizes.flatMap(size => SCHEMES.map(scheme => shotFileName(shot.id, size, scheme))));
}
