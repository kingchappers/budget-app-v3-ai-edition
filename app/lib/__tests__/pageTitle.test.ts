import { describe, it, expect } from 'vitest';
import { pageTitle } from '../pageTitle';

describe('pageTitle', () => {
  it('is just the app name with no parts', () => {
    expect(pageTitle()).toBe('Budget');
  });

  it('joins the parts with an en dash and ends with the app name', () => {
    expect(pageTitle('Transactions', 'September 2026')).toBe('Transactions – September 2026 – Budget');
  });

  it('skips empty parts', () => {
    expect(pageTitle('Settings', '')).toBe('Settings – Budget');
  });
});
