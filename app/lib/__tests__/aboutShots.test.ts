import { describe, it, expect } from 'vitest';
import { SHOTS, SIZES, SCHEMES, allShotFileNames, shotFileName, shotUrl } from '../aboutShots';

describe('aboutShots', () => {
  it('names a file from the id, size and scheme', () => {
    expect(shotFileName('home', 'phone', 'dark')).toBe('home-phone-dark.webp');
  });

  it('serves files from /about/', () => {
    expect(shotUrl('plan', 'desktop', 'light')).toBe('/about/plan-desktop-light.webp');
  });

  it('lists the 7 shots in page order, each with a unique id', () => {
    const ids = SHOTS.map(shot => shot.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(['home', 'add', 'transactions', 'plan', 'insights', 'recurring', 'settings']);
  });

  it('has 28 unique file names: every shot at both sizes and both schemes', () => {
    const names = allShotFileNames();
    expect(names).toHaveLength(SHOTS.length * Object.keys(SIZES).length * SCHEMES.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('gives every shot words for the page, and alt text that is not just "screenshot"', () => {
    for (const shot of SHOTS) {
      expect(shot.heading, shot.id).not.toBe('');
      expect(shot.caption, shot.id).not.toBe('');
      expect(shot.howTo, shot.id).not.toBe('');
      expect(shot.alt.toLowerCase(), shot.id).not.toBe('screenshot');
      expect(shot.alt.length, shot.id).toBeGreaterThan(20);
    }
  });
});
