import { DEFAULT_THEME } from '@mantine/core';
import { describe, expect, it } from 'vitest';
import { CHART_COLORS } from '../chartColors';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255)
    .map(channel => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

function hexFor(token: string): string {
  const [name, shade] = token.split('.');
  return DEFAULT_THEME.colors[name][Number(shade)];
}

describe('chart colours', () => {
  it.each(Object.entries(CHART_COLORS))('%s is at least 3:1 on the light and dark page', (_name, token) => {
    expect(contrast(hexFor(token), '#ffffff')).toBeGreaterThanOrEqual(3);
    expect(contrast(hexFor(token), '#242424')).toBeGreaterThanOrEqual(3);
  });

  it('no longer uses the 2.55:1 teal the audit flagged', () => {
    expect(Object.values(CHART_COLORS)).not.toContain('teal.6');
  });
});
