import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { InsightsHeadline } from '../InsightsHeadline';

describe('InsightsHeadline', () => {
  it('lists each sentence under a plain heading', () => {
    render(<MantineProvider><InsightsHeadline sentences={['One.', 'Two.']} /></MantineProvider>);
    expect(screen.getByRole('heading', { name: 'What stood out' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map(item => item.textContent)).toEqual(['One.', 'Two.']);
  });

  it('shows nothing when there is nothing to say', () => {
    render(<MantineProvider><InsightsHeadline sentences={[]} /></MantineProvider>);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });
});
