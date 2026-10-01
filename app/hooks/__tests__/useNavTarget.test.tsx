import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { useNavTarget } from '../useNavTarget';

function targetFor(url: string) {
  const wrapper = ({ children }: { children: React.ReactNode }) => <MemoryRouter initialEntries={[url]}>{children}</MemoryRouter>;
  return renderHook(() => useNavTarget(), { wrapper }).result.current;
}

describe('useNavTarget', () => {
  it('carries the viewed month to the pages that show a month', () => {
    const target = targetFor('/transactions?month=2026-08');
    expect(target('/')).toBe('/?month=2026-08');
    expect(target('/transactions')).toBe('/transactions?month=2026-08');
    expect(target('/insights')).toBe('/insights?month=2026-08');
  });

  it('leaves pages that have no month alone', () => {
    const target = targetFor('/?month=2026-08');
    expect(target('/targets')).toBe('/targets');
    expect(target('/pots')).toBe('/pots');
    expect(target('/categories')).toBe('/categories');
  });

  it('adds nothing when no month is selected, or the month is invalid', () => {
    expect(targetFor('/')('/transactions')).toBe('/transactions');
    expect(targetFor('/?month=nonsense')('/transactions')).toBe('/transactions');
  });
});
