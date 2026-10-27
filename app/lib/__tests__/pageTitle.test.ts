import { describe, it, expect } from 'vitest';
import { pageTitle, APP_NAME, APP_DESCRIPTION } from '../pageTitle';

describe('pageTitle', () => {
  it('is just the app name with no parts', () => {
    expect(pageTitle()).toBe('Hoardwise');
  });

  it('joins the parts with an en dash and ends with the app name', () => {
    expect(pageTitle('Transactions', 'September 2026')).toBe('Transactions – September 2026 – Hoardwise');
  });

  it('skips empty parts', () => {
    expect(pageTitle('Settings', '')).toBe('Settings – Hoardwise');
  });

  it('names the product Hoardwise and describes it in one calm sentence', () => {
    expect(APP_NAME).toBe('Hoardwise');
    expect(APP_DESCRIPTION).toBe('A calm way to keep track of your money.');
  });
});
