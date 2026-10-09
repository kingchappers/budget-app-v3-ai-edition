import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { allShotFileNames } from '~/lib/aboutShots';

const DIR = path.resolve(process.cwd(), 'public', 'about');

describe('About page images', () => {
  it('has a committed image for every shot, size and scheme', () => {
    const missing = allShotFileNames().filter(name => !existsSync(path.join(DIR, name)));
    expect(missing).toEqual([]);
  });

  it('has no image that the shot list does not mention', () => {
    const wanted = new Set(allShotFileNames());
    const extra = readdirSync(DIR).filter(name => name.endsWith('.webp') && !wanted.has(name));
    expect(extra).toEqual([]);
  });
});
