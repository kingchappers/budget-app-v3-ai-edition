import { chartColours } from './brand';

// Colour carries the app's meanings (see root.tsx): success for a change for the better, the brand for
// ordinary progress, and neutral text for spending, which is never alarming. Red is for errors only.
// Every shade is at least 3:1 against both the light page (mist) and the dark page (the brand surface),
// the WCAG 1.4.11 minimum for non-text contrast. Spending uses the page's own text colour, which always contrasts.
// `info` is the brand green's text shade, which resolves lighter in dark mode (see cssVariablesResolver).
// Of the brand's chartColours, only hoard.6 / hoard.4 / ember.6 clear 3:1 on mist, so gold.4 and hoard.2 are fills, not lines.
export const CHART_COLORS = {
  positive: 'success.7',
  spending: 'var(--mantine-color-text)',
  info: 'var(--mantine-color-hoard-text)',
  neutral: chartColours[2],
} as const;

// Series are also told apart without colour: solid, dashed, dotted.
export const CHART_DASHES = {
  solid: undefined,
  dashed: '6 4',
  dotted: '2 4',
} as const;
