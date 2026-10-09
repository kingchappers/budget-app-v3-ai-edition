import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { MemoryRouter } from 'react-router';
import { SHOTS } from '~/lib/aboutShots';
import { expectNoViolations, expectSoundHeadings } from '~/test-utils/accessibility';

const auth = vi.hoisted(() => ({ isAuthenticated: false, isLoading: false, error: undefined, loginWithRedirect: vi.fn() }));
vi.mock('@auth0/auth0-react', () => ({
  Auth0Provider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  useAuth0: () => auth,
}));
vi.mock('~/components/layout/DefaultLayout', () => ({
  DefaultLayout: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

import About from '../about';

function renderAbout() {
  return render(
    <MantineProvider>
      <MemoryRouter initialEntries={['/about']}>
        <About />
      </MemoryRouter>
    </MantineProvider>,
  );
}

beforeEach(() => {
  auth.loginWithRedirect.mockReset();
});

describe('About page', () => {
  it('has one h1 and no skipped heading levels', () => {
    const { container } = renderAbout();
    expectSoundHeadings(container);
  });

  it('has no labelling or heading violations', async () => {
    const { container } = renderAbout();
    await expectNoViolations(container);
  });

  it('has a section for every shot, headed by its heading', () => {
    renderAbout();
    for (const shot of SHOTS) {
      expect(screen.getByRole('heading', { level: 2, name: shot.heading })).toBeInTheDocument();
    }
  });

  it('shows each shot once, with its alt text, size, and lazy loading after the first', () => {
    const { container } = renderAbout();
    const images = [...container.querySelectorAll('picture img')] as HTMLImageElement[];
    expect(images).toHaveLength(SHOTS.length);
    images.forEach((img, index) => {
      expect(img.alt).toBe(SHOTS[index].alt);
      expect(img.getAttribute('width')).not.toBeNull();
      expect(img.getAttribute('height')).not.toBeNull();
      expect(img.getAttribute('loading')).toBe(index === 0 ? null : 'lazy');
    });
  });

  it('offers a dark image to people who prefer dark mode', () => {
    const { container } = renderAbout();
    const dark = container.querySelectorAll('picture source[media*="prefers-color-scheme: dark"]');
    expect(dark.length).toBeGreaterThanOrEqual(SHOTS.length);
    expect(dark[0].getAttribute('srcset')).toMatch(/-dark\.webp$/);
  });

  it('starts sign-in from the top button', async () => {
    renderAbout();
    const [topButton] = screen.getAllByRole('button', { name: 'Sign in' });
    await userEvent.setup().click(topButton);
    expect(auth.loginWithRedirect).toHaveBeenCalledTimes(1);
  });

  it('ends with a second sign-in button', () => {
    renderAbout();
    expect(screen.getAllByRole('button', { name: 'Sign in' })).toHaveLength(2);
  });

  it('explains what a pot is in the same words as the in-app help', () => {
    renderAbout();
    const faq = screen.getByRole('heading', { level: 2, name: 'Common questions' }).parentElement as HTMLElement;
    expect(within(faq).getByText(/money kept apart/i)).toBeInTheDocument();
  });
});
