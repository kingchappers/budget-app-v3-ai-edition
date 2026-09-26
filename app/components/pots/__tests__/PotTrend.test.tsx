import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PotTrend, trendPoints } from '../PotTrend';

describe('trendPoints', () => {
  it('is empty with fewer than two values', () => {
    expect(trendPoints([])).toBe('');
    expect(trendPoints([5])).toBe('');
  });

  it('scales values into the box, top for the highest', () => {
    expect(trendPoints([0, 10])).toBe('0.0,32.0 100.0,0.0');
  });

  it('draws a flat line along the bottom when all values are equal', () => {
    expect(trendPoints([5, 5, 5])).toBe('0.0,32.0 50.0,32.0 100.0,32.0');
  });

  it('handles negative values', () => {
    expect(trendPoints([-10, 0])).toBe('0.0,32.0 100.0,0.0');
  });
});

describe('PotTrend', () => {
  it('renders an image role with a polyline for two or more values', () => {
    const { container, getByRole } = render(<PotTrend values={[1, 2, 3]} />);
    expect(getByRole('img', { name: 'Balance trend' })).toBeInTheDocument();
    expect(container.querySelector('polyline')).not.toBeNull();
  });

  it('renders nothing for fewer than two values', () => {
    const { container } = render(<PotTrend values={[1]} />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
