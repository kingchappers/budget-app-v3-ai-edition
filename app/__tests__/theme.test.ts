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

  it('does not regress light mode dimmed text contrast', () => {
    const gray6 = mergedTheme.colors.gray[6];

    expect(gray6).toBeTruthy();
    expect(contrastRatio(gray6, '#ffffff')).toBeGreaterThanOrEqual(4.5);
  });
});

describe('motion', () => {
  it('follows the device reduced-motion setting', () => {
    expect(mergedTheme.respectReducedMotion).toBe(true);
  });
});
