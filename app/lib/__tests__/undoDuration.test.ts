import { describe, expect, it } from 'vitest';
import { UNDO_DURATION_OPTIONS, undoAutoClose } from '../undoDuration';

describe('undoAutoClose', () => {
  it('stays until dismissed for "Until I close them"', () => {
    expect(undoAutoClose('until-closed')).toBe(false);
  });

  it('turns seconds into milliseconds', () => {
    expect(undoAutoClose('30s')).toBe(30000);
    expect(undoAutoClose('10s')).toBe(10000);
  });

  it('offers the three choices in plain words, the default first', () => {
    expect(UNDO_DURATION_OPTIONS.map(option => option.label)).toEqual(['Until I close them', '30 seconds', '10 seconds']);
  });
});
