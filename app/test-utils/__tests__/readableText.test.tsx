import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge, MantineProvider, Text } from '@mantine/core';
import { expectReadable } from '../readableText';

function renderIn(ui: React.ReactNode) {
  return render(<MantineProvider>{ui}</MantineProvider>);
}

// If these stopped failing, every readability check in the app would pass for nothing.
describe('expectReadable', () => {
  it('passes for ordinary small and medium text', () => {
    renderIn(<><Text size="sm">small</Text><Text>medium</Text></>);
    expectReadable(screen.getByText('small'));
    expectReadable(screen.getByText('medium'));
  });

  it('catches size xs', () => {
    renderIn(<Text size="xs">tiny</Text>);
    expect(() => expectReadable(screen.getByText('tiny'))).toThrow();
  });

  it('catches dimmed text', () => {
    renderIn(<Text c="dimmed">faint</Text>);
    expect(() => expectReadable(screen.getByText('faint'))).toThrow();
  });

  it('catches an extra small badge', () => {
    renderIn(<Badge size="xs">badge</Badge>);
    expect(() => expectReadable(screen.getByText('badge').closest('.mantine-Badge-root') as HTMLElement)).toThrow();
  });
});
