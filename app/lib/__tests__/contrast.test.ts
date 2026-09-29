import { describe, it, expect } from 'vitest';
import { contrastRatio } from '../contrast';

describe('contrastRatio', () => {
  it('returns 21:1 for black on white', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1);
  });

  it('returns 1:1 for identical colors', () => {
    expect(contrastRatio('#828282', '#828282')).toBeCloseTo(1, 5);
  });

  it('is symmetric regardless of argument order', () => {
    expect(contrastRatio('#242424', '#909090')).toBeCloseTo(contrastRatio('#909090', '#242424'), 5);
  });
});
