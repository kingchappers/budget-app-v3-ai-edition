import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { useSelectedMonth } from '../useSelectedMonth';
import { currentYearMonth, shiftMonth } from '~/lib/months';

function setup(initialUrl: string) {
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <MemoryRouter initialEntries={[initialUrl]}>{children}</MemoryRouter>
  );
  return renderHook(() => ({ month: useSelectedMonth(), location: useLocation() }), { wrapper });
}

describe('useSelectedMonth', () => {
  it('is the current month when the URL says nothing', () => {
    const { result } = setup('/transactions');
    expect(result.current.month[0]).toBe(currentYearMonth());
  });

  it('reads the month from the URL, so a link or a reload lands on the same month', () => {
    const { result } = setup('/transactions?month=2026-08');
    expect(result.current.month[0]).toBe('2026-08');
  });

  it('ignores a month that is not valid', () => {
    for (const bad of ['nonsense', '2026-13', '2026-9', '']) {
      const { result } = setup(`/?month=${bad}`);
      expect(result.current.month[0]).toBe(currentYearMonth());
    }
  });

  it('writes a chosen month to the URL', () => {
    const { result } = setup('/transactions');
    const other = shiftMonth(currentYearMonth(), -2);
    act(() => result.current.month[1](other));
    expect(result.current.location.search).toBe(`?month=${other}`);
    expect(result.current.month[0]).toBe(other);
  });

  it('keeps the URL clean for the current month', () => {
    const { result } = setup('/transactions?month=2026-08');
    act(() => result.current.month[1](currentYearMonth()));
    expect(result.current.location.search).toBe('');
  });

  it('leaves other parameters alone', () => {
    const { result } = setup('/transactions?category=g&spending=untargeted');
    act(() => result.current.month[1]('2026-08'));
    const params = new URLSearchParams(result.current.location.search);
    expect(params.get('month')).toBe('2026-08');
    expect(params.get('category')).toBe('g');
    expect(params.get('spending')).toBe('untargeted');
  });
});
