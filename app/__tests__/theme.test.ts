import { describe, it, expect } from 'vitest';
import { DEFAULT_THEME, mergeMantineTheme } from '@mantine/core';
import { contrastRatio } from '~/lib/contrast';
import { cssVariablesResolver, theme } from '../root';

const mergedTheme = mergeMantineTheme(DEFAULT_THEME, theme);

// Mantine's own default dark palette (this app's theme does not override
// `dark`): --mantine-color-body resolves to dark.7 in dark mode, and Mantine's
// default --mantine-color-dimmed resolves to dark.2 unless overridden.
const MANTINE_DEFAULT_DARK_BODY = '#242424';

describe('dark mode dimmed text contrast', () => {
  it('reaches at least 4.5:1 against the dark body background (WCAG AA for normal text)', () => {
    const resolved = cssVariablesResolver(mergedTheme);
    const dimmed = resolved.dark?.['--mantine-color-dimmed'];

    expect(dimmed).toBeTruthy();
    expect(contrastRatio(dimmed as string, MANTINE_DEFAULT_DARK_BODY)).toBeGreaterThanOrEqual(4.5);
  });

  it('also reaches 4.5:1 on a card, which sits lighter than the page (#2e2e2e)', () => {
    const dimmed = cssVariablesResolver(mergedTheme).dark?.['--mantine-color-dimmed'];
    expect(contrastRatio(dimmed as string, '#2e2e2e')).toBeGreaterThanOrEqual(4.5);
  });

  it('does not regress light mode dimmed text contrast', () => {
    const gray6 = mergedTheme.colors.gray[6];

    expect(gray6).toBeTruthy();
    expect(contrastRatio(gray6, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

// Colour carries a small set of meanings, and each must be readable as text in
// both modes. Mantine uses shade 7 for text in light mode and shade 4 in dark
// mode (see getCSSColorVariables), so those are the shades checked here.
//   primary   - the brand, and neutral "good" progress
//   attention - something worth a look, in a calm hue that isn't red
//   success   - a change for the better
//   danger    - reserved for real errors and destructive actions, never ordinary data
describe('meaning colours', () => {
  it.each(['primary', 'attention', 'success'])('%s text reads at 4.5:1 in light mode', name => {
    expect(contrastRatio(mergedTheme.colors[name][7], '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['primary', 'attention', 'success'])('%s text reads at 4.5:1 in dark mode', name => {
    expect(contrastRatio(mergedTheme.colors[name][4], MANTINE_DEFAULT_DARK_BODY)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps attention visibly different from danger', () => {
    expect(mergedTheme.colors.attention[7]).not.toBe(mergedTheme.colors.danger[7]);
  });
});

describe('motion', () => {
  it('follows the device reduced-motion setting', () => {
    expect(mergedTheme.respectReducedMotion).toBe(true);
  });
});
