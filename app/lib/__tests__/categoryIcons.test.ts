import { describe, it, expect } from 'vitest';
import { IconHome, IconCategory } from '@tabler/icons-react';
import { getCategoryIcon, isEmojiIcon, categoryLabel } from '../categoryIcons';

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

describe('isEmojiIcon', () => {
  it.each(['🏠', '🗓️', '🧑‍🌾', '✈️', '⚡', '🪟'])('detects %s as an emoji', (icon) => {
    expect(isEmojiIcon(icon)).toBe(true);
  });

  it.each(['home', 'tag', '', 'not-a-real-icon'])('does not treat %j as an emoji', (icon) => {
    expect(isEmojiIcon(icon)).toBe(false);
  });
});

describe('categoryLabel', () => {
  it('puts the emoji before the name', () => {
    expect(categoryLabel({ icon: '🛒', name: 'Groceries' })).toBe('🛒 Groceries');
  });

  it('is just the name for a Tabler key', () => {
    expect(categoryLabel({ icon: 'tag', name: 'Padel' })).toBe('Padel');
  });
});
