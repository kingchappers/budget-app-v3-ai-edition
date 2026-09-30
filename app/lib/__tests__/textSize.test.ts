import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { TEXT_SIZE_OPTIONS, TEXT_SIZE_PERCENT, TEXT_SIZE_SCRIPT } from '../textSize';

const css = readFileSync(resolve(__dirname, '../../app.css'), 'utf8');

function runScript(): string | null {
  // eslint-disable-next-line no-new-func
  new Function(TEXT_SIZE_SCRIPT)();
  return document.documentElement.getAttribute('data-text-size');
}

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute('data-text-size');
});

describe('text size scale', () => {
  it('has Standard, Large and Largest, at 100%, 112.5% and 125%', () => {
    expect(TEXT_SIZE_OPTIONS.map(option => option.label)).toEqual(['Standard', 'Large', 'Largest']);
    expect(TEXT_SIZE_PERCENT).toEqual({ standard: 100, large: 112.5, largest: 125 });
  });

  it('is applied to the root font size in app.css, so every rem-based size follows', () => {
    expect(css).toMatch(/html\[data-text-size='large'\]\s*{\s*font-size:\s*112\.5%;/);
    expect(css).toMatch(/html\[data-text-size='largest'\]\s*{\s*font-size:\s*125%;/);
  });

  it('keeps phone inputs at least 16px, growing with the text, rather than fixing them at 16px', () => {
    expect(css).toMatch(/input,\s*select,\s*textarea\s*{\s*font-size:\s*1rem !important;/);
  });
});

describe('the script that runs before the page paints', () => {
  it('applies a larger size before anything is drawn', () => {
    window.localStorage.setItem('budget.preferences', JSON.stringify({ textSize: 'largest' }));
    expect(runScript()).toBe('largest');
  });

  it('applies Large too', () => {
    window.localStorage.setItem('budget.preferences', JSON.stringify({ textSize: 'large' }));
    expect(runScript()).toBe('large');
  });

  it('leaves standard size alone', () => {
    window.localStorage.setItem('budget.preferences', JSON.stringify({ textSize: 'standard' }));
    expect(runScript()).toBeNull();
  });

  it('ignores a value it does not know, instead of setting it', () => {
    window.localStorage.setItem('budget.preferences', JSON.stringify({ textSize: '999%' }));
    expect(runScript()).toBeNull();
  });

  it('does nothing, and does not throw, when nothing is saved or the saved text is broken', () => {
    expect(runScript()).toBeNull();
    window.localStorage.setItem('budget.preferences', '{not json');
    expect(runScript()).toBeNull();
  });
});
