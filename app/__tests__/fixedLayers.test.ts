import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, '../app.css'), 'utf8');

describe('fixed layers at the bottom of the screen', () => {
  it('scrolls a focused control clear of the phone tab bar', () => {
    expect(css).toMatch(/scroll-padding-bottom:\s*calc\(var\(--tab-bar-height\)/);
  });

  it('has no tab bar height on wide screens, so nothing is reserved there', () => {
    expect(css).toMatch(/:root\s*{\s*--tab-bar-height:\s*0px;/);
  });

  it('puts phone toasts just above the tab bar, not a fixed 150px up', () => {
    expect(css).toMatch(/\[data-position='bottom-center'\]\s*{\s*bottom:\s*calc\(var\(--tab-bar-height\)/);
    expect(css).not.toContain('150px');
  });

  it('has no rule that makes room for a floating add button any more', () => {
    expect(css).not.toMatch(/floating/i);
  });
});
