// Every shade here is at least 3:1 against both the light page (white) and the
// dark page (#242424), the WCAG 1.4.11 minimum for non-text contrast.
export const CHART_COLORS = {
  positive: 'teal.8',
  negative: 'red.7',
  info: 'blue.7',
  neutral: 'gray.6',
} as const;

// Series are also told apart without colour: solid, dashed, dotted.
export const CHART_DASHES = {
  solid: undefined,
  dashed: '6 4',
  dotted: '2 4',
} as const;
