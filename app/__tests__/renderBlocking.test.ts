import { describe, it, expect } from 'vitest';
import { links } from '../root';

describe('page head', () => {
  it('loads no stylesheet from another site, which leaves the page blank while that site is slow or blocked', () => {
    const stylesheets = (links() as Array<{ rel: string; href?: string }>).filter(l => l.rel === 'stylesheet');
    const external = stylesheets.filter(l => /^(https?:)?\/\//.test(l.href ?? ''));
    expect(external).toEqual([]);
  });
});
