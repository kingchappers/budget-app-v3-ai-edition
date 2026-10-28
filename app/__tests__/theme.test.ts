import { describe, it, expect } from 'vitest';
import { DEFAULT_THEME, mergeMantineTheme } from '@mantine/core';
import { contrastRatio } from '~/lib/contrast';
import { BRAND } from '~/lib/brand';
import { cssVariablesResolver, theme } from '../root';

const mergedTheme = mergeMantineTheme(DEFAULT_THEME, theme);
const resolved = cssVariablesResolver(mergedTheme);

// Light mode: text sits on the Mist page or on a white card. Dark mode: on the brand surface
// (dark.7, Mantine's body in dark mode) or on a card (dark.6).
const LIGHT_PAGE = BRAND.mist;
const LIGHT_CARD = '#ffffff';
const DARK_PAGE = mergedTheme.colors.dark[7];
const DARK_CARD = mergedTheme.colors.dark[6];

describe('brand surfaces', () => {
  it('uses the brand surface as the dark page', () => {
    expect(DARK_PAGE.toLowerCase()).toBe(BRAND.surface.toLowerCase());
  });

  it('uses Mist as the light page and Pine as the light text', () => {
    expect(resolved.light?.['--mantine-color-body']).toBe(BRAND.mist);
    expect(mergedTheme.black).toBe(BRAND.pine);
  });
});

describe('dimmed text contrast', () => {
  it('reaches 4.5:1 on the dark page and on a dark card (WCAG AA for normal text)', () => {
    const dimmed = resolved.dark?.['--mantine-color-dimmed'] as string;

    expect(dimmed).toBeTruthy();
    expect(contrastRatio(dimmed, DARK_PAGE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dimmed, DARK_CARD)).toBeGreaterThanOrEqual(4.5);
  });

  it('reaches 4.5:1 on the light page and on a white card', () => {
    const dimmed = resolved.light?.['--mantine-color-dimmed'] as string;

    expect(contrastRatio(dimmed, LIGHT_PAGE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(dimmed, LIGHT_CARD)).toBeGreaterThanOrEqual(4.5);
  });

  it('reaches 4.5:1 for body text in dark mode', () => {
    expect(contrastRatio(mergedTheme.colors.dark[0], DARK_PAGE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(mergedTheme.colors.dark[0], DARK_CARD)).toBeGreaterThanOrEqual(4.5);
  });
});

// Colour carries a small set of meanings, and each must be readable as text in
// both modes. Mantine uses shade 6 for text in light mode; in dark mode the -text variable is
// overridden for hoard and ember (shade 4 is too dim on a card), and is shade 4 for success.
//   hoard   - the brand, and neutral "good" progress
//   ember   - something worth a look, in a calm hue that isn't red
//   success - a change for the better
//   danger  - reserved for real errors and destructive actions, never ordinary data
describe('meaning colours', () => {
  const darkText: Record<string, string> = {
    hoard: resolved.dark?.['--mantine-color-hoard-text'] as string,
    ember: resolved.dark?.['--mantine-color-ember-text'] as string,
    success: mergedTheme.colors.success[4],
  };

  it.each(['hoard', 'ember'])('%s text reads at 4.5:1 on the light page and a white card', name => {
    expect(contrastRatio(mergedTheme.colors[name][6], LIGHT_PAGE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(mergedTheme.colors[name][6], LIGHT_CARD)).toBeGreaterThanOrEqual(4.5);
  });

  it('success text reads at 4.5:1 in light mode', () => {
    expect(contrastRatio(mergedTheme.colors.success[7], LIGHT_PAGE)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(['hoard', 'ember', 'success'])('%s text reads at 4.5:1 on the dark page and a dark card', name => {
    expect(contrastRatio(darkText[name], DARK_PAGE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkText[name], DARK_CARD)).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps white text on a filled hoard button at 4.5:1', () => {
    const shade = mergedTheme.primaryShade as { light: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9; dark: 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 };
    expect(contrastRatio('#ffffff', mergedTheme.colors.hoard[shade.light])).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', mergedTheme.colors.hoard[shade.dark])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps ember visibly different from danger', () => {
    expect(mergedTheme.colors.ember[6]).not.toBe(mergedTheme.colors.danger[7]);
  });
});

describe('motion', () => {
  it('follows the device reduced-motion setting', () => {
    expect(mergedTheme.respectReducedMotion).toBe(true);
  });
});

describe('error text contrast', () => {
  it('reaches 4.5:1 on the light page and a white card', () => {
    const error = resolved.light?.['--mantine-color-error'] as string;
    expect(contrastRatio(error, LIGHT_PAGE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(error, LIGHT_CARD)).toBeGreaterThanOrEqual(4.5);
  });

  it('reaches 4.5:1 on the dark page and on a dark card', () => {
    const error = resolved.dark?.['--mantine-color-error'] as string;
    expect(contrastRatio(error, DARK_PAGE)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(error, DARK_CARD)).toBeGreaterThanOrEqual(4.5);
  });
});
