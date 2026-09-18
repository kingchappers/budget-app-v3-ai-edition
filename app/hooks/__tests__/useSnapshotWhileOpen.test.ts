import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useSnapshotWhileOpen } from '../useSnapshotWhileOpen';

describe('useSnapshotWhileOpen', () => {
  it('tracks the value while closed and holds it steady while open', () => {
    const first = [1];
    const second = [1, 2];
    const third = [1, 2, 3];
    const { result, rerender } = renderHook(
      ({ value, opened }) => useSnapshotWhileOpen(value, opened),
      { initialProps: { value: first, opened: false } },
    );
    expect(result.current).toBe(first);

    rerender({ value: second, opened: false });
    expect(result.current).toBe(second);

    rerender({ value: second, opened: true });
    rerender({ value: third, opened: true });
    expect(result.current).toBe(second);

    rerender({ value: third, opened: false });
    expect(result.current).toBe(third);
  });

  it('adopts the first defined value even when it arrives while open', () => {
    const loaded = [1];
    const { result, rerender } = renderHook(
      ({ value, opened }) => useSnapshotWhileOpen(value, opened),
      { initialProps: { value: undefined as number[] | undefined, opened: true } },
    );
    expect(result.current).toBeUndefined();

    rerender({ value: loaded, opened: true });
    expect(result.current).toBe(loaded);
  });
});
