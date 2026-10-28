// The one place brand hex values live (see docs/brand.md). Everything else uses Mantine theme tokens
// (hoard, gold, ember) or the --hw-* variables in app.css.
import type { MantineColorsTuple } from '@mantine/core';

// Primary: "hoard" green. Index 6 (#1E5F57) is 7.4:1 on white, so it is safe for text and buttons.
export const hoard: MantineColorsTuple = [
  '#EDF5F3', '#D4E3E0', '#B3CBC7', '#90B2AD', '#66948E',
  '#3F7770', '#1E5F57', '#174A44', '#113934', '#0C2824',
];

// Gold: use 3–4 (#E3B65C / #D9A441) for the logo, illustrations and fills only.
// For gold *text* on light backgrounds use 6 (#86601A, 5.7:1 on white) or darker.
export const gold: MantineColorsTuple = [
  '#FCF6E8', '#F6E9C8', '#EED69E', '#E3B65C', '#D9A441',
  '#B4842C', '#86601A', '#6C4D14', '#563D0F', '#402D0A',
];

// Ember: attention / overspend. Always pair with an icon or label, never colour alone.
export const ember: MantineColorsTuple = [
  '#FBEFEA', '#F1DBD3', '#E3C1B4', '#D4A494', '#C2836D',
  '#B26449', '#A4492A', '#823920', '#662C17', '#4A1F0F',
];

// Dark mode is tinted from Pine rather than neutral grey. Mantine reads dark.7 as the page, dark.6 as a
// card, dark.0 as text and dark.2 as dimmed text, so 7 is the brand surface and 0 the brand text.
export const dark: MantineColorsTuple = [
  '#DDE7E3', '#C3D0CB', '#9DB0AA', '#7A8F89', '#3A524C',
  '#2A413C', '#17302C', '#0C1F1C', '#08171A', '#050F11',
];

export const BRAND = {
  pine: '#10302B',
  mist: '#F2F5F3',
  muted: '#4A5C57',
  surface: '#0C1F1C',
  // In dark mode the brand's own text-weight shades: Mantine's default shade 4 would be too dim
  // on a card (hoard.4 is 4.1:1 there), so the -text variables are pointed at these.
  darkHoardText: '#5FB3A6',
  darkEmberText: '#E08A68',
  darkGoldText: '#E3B65C',
} as const;

// Chart series in a calm order; distinguishable by lightness as well as hue. Written as theme
// tokens so they follow the palettes above: hoard.6, gold.4, hoard.4, gold.6, hoard.2, ember.6.
export const chartColours = ['hoard.6', 'gold.4', 'hoard.4', 'gold.6', 'hoard.2', 'ember.6'] as const;
