import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { render, screen } from '@testing-library/react';
import { MantineProvider } from '@mantine/core';
import { InlineSpans, InlineText } from '../InlineText';
import { FieldList } from '../FieldList';

function renderText(text: string) {
  return render(<MantineProvider><InlineText text={text} /></MantineProvider>);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === '__tests__') return [];
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

describe('InlineText', () => {
  it('renders blank-line separated paragraphs', () => {
    const { container } = renderText('First one.\n\nSecond one.');
    const paragraphs = container.querySelectorAll('p');
    expect(Array.from(paragraphs).map((p) => p.textContent)).toEqual(['First one.', 'Second one.']);
  });

  it('renders lines starting with a dash as a bullet list', () => {
    renderText('Intro.\n\n- one\n- two');
    expect(screen.getAllByRole('listitem').map((li) => li.textContent)).toEqual(['one', 'two']);
  });

  it('renders backtick spans as code', () => {
    const { container } = renderText('Use `year` and `month`.');
    expect(Array.from(container.querySelectorAll('code')).map((c) => c.textContent)).toEqual(['year', 'month']);
  });

  it('shows raw HTML as literal text with no element created', () => {
    const { container } = renderText('<img src=x onerror=alert(1)>');
    expect(container.querySelector('img')).toBeNull();
    expect(container).toHaveTextContent('<img src=x onerror=alert(1)>');
  });

  it('shows markdown links as literal text with no anchor', () => {
    const { container } = renderText('[x](javascript:alert(1))');
    expect(container.querySelector('a')).toBeNull();
    expect(container).toHaveTextContent('[x](javascript:alert(1))');
  });

  it('keeps markup inside a code span as text', () => {
    const { container } = renderText('`<b>x</b>`');
    expect(container.querySelector('b')).toBeNull();
    expect(container.querySelector('code')).toHaveTextContent('<b>x</b>');
  });
});

describe('docs components', () => {
  it('never use dangerouslySetInnerHTML', () => {
    const dir = resolve(__dirname, '..');
    const offenders = sourceFiles(dir).filter((f) => readFileSync(f, 'utf8').includes('dangerouslySetInnerHTML'));
    expect(offenders).toEqual([]);
  });
});

describe('InlineText structure', () => {
  it('renders a ## line as a heading', () => {
    renderText('## Errors\n\nSomething.');
    expect(screen.getByRole('heading', { name: 'Errors' })).toBeInTheDocument();
  });

  it('joins a wrapped bullet into one item and ends the list at a blank line', () => {
    const { container } = renderText('- first line\n  continued\n- second\n\nAfter.');
    expect(Array.from(container.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['first line continued', 'second']);
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('starts a list directly after a paragraph line', () => {
    const { container } = renderText('Token rules:\n- a\n- b');
    expect(container.querySelector('p')).toHaveTextContent('Token rules:');
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });
});

describe('code spans', () => {
  it('renders a span in a field description as code with no backtick', () => {
    const { container } = render(
      <MantineProvider>
        <FieldList fields={[{ name: 'pence', type: 'integer', required: true, description: 'Sent as `pence`.' }]} />
      </MantineProvider>,
    );
    expect(Array.from(container.querySelectorAll('code')).map((c) => c.textContent)).toContain('pence');
    expect(container.textContent).not.toContain('`');
    expect(container.querySelector('p p')).toBeNull();
  });

  it('keeps a stray backtick', () => {
    const { container } = render(<MantineProvider><InlineSpans text="it`s odd" /></MantineProvider>);
    expect(container).toHaveTextContent('it`s odd');
    expect(container.querySelector('code')).toBeNull();
  });

  it('keeps a stray backtick after a complete span', () => {
    const { container } = render(<MantineProvider><InlineSpans text="`a` and ` b" /></MantineProvider>);
    expect(container.querySelectorAll('code')).toHaveLength(1);
    expect(container).toHaveTextContent('a and ` b');
  });
});
