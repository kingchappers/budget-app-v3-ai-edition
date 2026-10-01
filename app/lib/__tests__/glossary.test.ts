import { describe, expect, it } from 'vitest';
import { GLOSSARY, GLOSSARY_KEYS } from '../glossary';

describe('glossary', () => {
  it.each(GLOSSARY_KEYS)('%s has a term, one sentence and an example', key => {
    const { term, definition, example } = GLOSSARY[key];
    expect(term.trim()).not.toBe('');
    expect(definition).toMatch(/^[^.!?]+[.]$/);
    expect(example.trim()).not.toBe('');
  });

  it('uses the plain name for the old "Sinking Funds" group', () => {
    expect(GLOSSARY.groupKnownCosts.term).toBe('Saving for known costs');
  });
});
