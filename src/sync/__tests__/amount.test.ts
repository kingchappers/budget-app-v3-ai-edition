import { describe, it, expect } from 'vitest';
import { parseAmountToPence } from '../amount';

describe('parseAmountToPence', () => {
  it.each([
    ['12.34', 1234],
    ['12.3', 1230],
    ['12', 1200],
    ['0.01', 1],
    ['0.00', 0],
  ])('parses %s as %i pence', (input, expected) => {
    expect(parseAmountToPence(input)).toBe(expected);
  });

  it.each(['12.345', '1e3', '', 'abc', '-5.00', '12.', '.5', ' 12'])('rejects %j', input => {
    expect(parseAmountToPence(input)).toBeNull();
  });
});
