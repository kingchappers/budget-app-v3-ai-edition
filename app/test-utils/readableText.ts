import { expect } from 'vitest';

// Text that helps someone decide, or find their place, is at least 14px and at full
// contrast. Mantine marks named sizes with data-size ("xs" is 12px) and dimmed colour
// as a custom property, so both can be seen on the rendered element.
export function expectReadable(element: HTMLElement): void {
  expect(element.getAttribute('data-size'), `${element.textContent} should not be size xs`).not.toBe('xs');
  expect(element.getAttribute('style') ?? '', `${element.textContent} should not be dimmed`).not.toMatch(/dimmed/);
}
