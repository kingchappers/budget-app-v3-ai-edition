import { describe, it, expect } from 'vitest';
import { IconHome, IconCategory } from '@tabler/icons-react';
import { getCategoryIcon } from '../categoryIcons';

describe('getCategoryIcon', () => {
  it('returns the mapped icon for a known name', () => {
    expect(getCategoryIcon('home')).toBe(IconHome);
  });

  it('falls back to a generic icon for an unknown name', () => {
    expect(getCategoryIcon('not-a-real-icon')).toBe(IconCategory);
  });

  it('falls back to a generic icon for an empty string', () => {
    expect(getCategoryIcon('')).toBe(IconCategory);
  });
});
