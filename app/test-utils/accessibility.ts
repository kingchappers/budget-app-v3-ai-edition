import axe from 'axe-core';
import { expect } from 'vitest';

// The rules that match what the audit found: names, labels and headings. Colour contrast and target
// size need real layout, which the test environment does not have, so they are checked another way.
const RULES = ['label', 'button-name', 'link-name', 'aria-allowed-attr', 'aria-valid-attr-value', 'empty-heading', 'heading-order', 'select-name'];

export async function expectNoViolations(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { runOnly: { type: 'rule', values: RULES } });
  const summary = results.violations.map(violation => `${violation.id}: ${violation.nodes.map(node => node.html).join(' | ')}`);
  expect(summary).toEqual([]);
}

// Reads the page's headings as an outline: [level, text].
export function headingOutline(container: HTMLElement): [number, string][] {
  return [...container.querySelectorAll('h1, h2, h3, h4, h5, h6')]
    .map(heading => [Number(heading.tagName[1]), heading.textContent ?? ''] as [number, string]);
}

// One h1, and no level skipped on the way down.
export function expectSoundHeadings(container: HTMLElement): void {
  const outline = headingOutline(container);
  expect(outline.filter(([level]) => level === 1), 'exactly one h1').toHaveLength(1);
  outline.reduce((previous, [level, text]) => {
    expect(level - previous, `"${text}" (h${level}) follows h${previous}`).toBeLessThanOrEqual(1);
    return level;
  }, 0);
}
