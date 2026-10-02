import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, vi } from 'vitest';

// Vitest runs without `globals`, so Testing Library's auto-cleanup never registers.
afterEach(cleanup);

// Mantine menus, dialogs and drawers animate open and closed. CI runs the
// whole suite in parallel on a slower machine, which can push findBy* and
// waitFor past Testing Library's 1s default for tests that pass in isolation.
configure({ asyncUtilTimeout: 3000 });

// Mantine animates menus, dialogs and drawers with timers, so under load a test can wait seconds for an
// item that is already on its way. Its test mode switches the transitions and portals off. Every test
// gets it by default; one that needs the real behaviour can pass env="default".
vi.mock('@mantine/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@mantine/core')>();
  const MantineProvider = (props: React.ComponentProps<typeof actual.MantineProvider>) =>
    createElement(actual.MantineProvider, { env: 'test', ...props });
  return { ...actual, MantineProvider };
});

// Mantine reads matchMedia and ResizeObserver at mount; jsdom provides neither.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

window.ResizeObserver = ResizeObserverStub;

// Mantine's Combobox scrolls the highlighted option into view; jsdom has no layout.
Element.prototype.scrollIntoView = () => {};

// Recharts measures its container via getBoundingClientRect to size its
// ResponsiveContainer; jsdom always returns zeros, which renders every
// chart at 0x0 and makes its content untestable.
Element.prototype.getBoundingClientRect = () => ({
  width: 800, height: 400, top: 0, left: 0, right: 800, bottom: 400, x: 0, y: 0, toJSON() {},
});
