import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { expectNoViolations, expectSoundHeadings, headingOutline } from '../accessibility';

// If these stopped failing, the accessibility checks across the app would pass for nothing.
describe('the accessibility helpers', () => {
  it('catch a control with no label and a button with no name', async () => {
    const { container } = render(<div><input /><button /></div>);
    await expect(expectNoViolations(container)).rejects.toThrow();
  });

  it('pass labelled controls', async () => {
    const { container } = render(<div><label>Name <input /></label><button>Save</button></div>);
    await expectNoViolations(container);
  });

  it('read the heading outline', () => {
    const { container } = render(<div><h1>Page</h1><h2>Section</h2></div>);
    expect(headingOutline(container)).toEqual([[1, 'Page'], [2, 'Section']]);
  });

  it('catch a page with no h1, two h1s, or a skipped level', () => {
    expect(() => expectSoundHeadings(render(<div><h2>Section</h2></div>).container)).toThrow();
    expect(() => expectSoundHeadings(render(<div><h1>A</h1><h1>B</h1></div>).container)).toThrow();
    expect(() => expectSoundHeadings(render(<div><h1>A</h1><h3>B</h3></div>).container)).toThrow();
  });

  it('pass a sound outline, including going back up', () => {
    expectSoundHeadings(render(<div><h1>A</h1><h2>B</h2><h3>C</h3><h2>D</h2></div>).container);
  });
});
