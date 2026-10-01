// Colour carries the app's meanings (see root.tsx): success for a change for the better, the brand for
// ordinary progress, and neutral text for spending, which is never alarming. Red is for errors only.
// Every shade is at least 3:1 against both the light page (white) and the dark page (#242424), the
// WCAG 1.4.11 minimum for non-text contrast. Spending uses the page's own text colour, which always contrasts.
export const CHART_COLORS = {
  positive: 'success.7',
  spending: 'var(--mantine-color-text)',
  info: 'primary.6',
  neutral: 'gray.5',
} as const;

// Series are also told apart without colour: solid, dashed, dotted.
export const CHART_DASHES = {
  solid: undefined,
  dashed: '6 4',
  dotted: '2 4',
} as const;
