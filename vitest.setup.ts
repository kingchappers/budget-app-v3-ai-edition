import 'fake-indexeddb/auto';
import '@testing-library/jest-dom/vitest';
import { cleanup, configure } from '@testing-library/react';
import { afterEach } from 'vitest';

// Vitest runs without `globals`, so Testing Library's auto-cleanup never registers.
afterEach(cleanup);

// Mantine menus, dialogs and drawers animate open and closed. CI runs the
// whole suite in parallel on a slower machine, which can push findBy* and
// waitFor past Testing Library's 1s default for tests that pass in isolation.
configure({ asyncUtilTimeout: 3000 });

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
