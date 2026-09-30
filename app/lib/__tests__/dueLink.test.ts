import { describe, expect, it } from 'vitest';
import { parseDueLink, withoutDueLink } from '../dueLink';

const params = (query: string) => new URLSearchParams(query);

describe('parseDueLink', () => {
  it('reads the bill, the period and the action a reminder sets', () => {
    expect(parseDueLink(params('due=3f2b8c1e-9a4d-4e7f-b1c2-0d9e8f7a6b5c&period=2026-10&action=add'))).toEqual({
      recurringId: '3f2b8c1e-9a4d-4e7f-b1c2-0d9e8f7a6b5c', period: '2026-10', action: 'add',
    });
  });

  it('reads skip as well', () => {
    expect(parseDueLink(params('due=abc&period=2026-10&action=skip'))?.action).toBe('skip');
  });

  it('reads a dated period for a yearly or weekly bill', () => {
    expect(parseDueLink(params('due=abc&period=2026-10-14&action=add'))?.period).toBe('2026-10-14');
  });

  it('opens the bill without doing anything when a tap has no action', () => {
    expect(parseDueLink(params('due=abc&period=2026-10'))).toEqual({ recurringId: 'abc', period: '2026-10', action: null });
  });

  it('is nothing at all without a bill', () => {
    expect(parseDueLink(params(''))).toBeNull();
    expect(parseDueLink(params('period=2026-10&action=add'))).toBeNull();
  });

  it.each([
    ['an action it does not know', 'due=abc&action=delete'],
    ['an action in capitals', 'due=abc&action=ADD'],
    ['an empty action', 'due=abc&action='],
  ])('ignores %s, but still opens the bill', (_name, query) => {
    expect(parseDueLink(params(query))?.action).toBeNull();
  });

  it.each([
    ['a month out of range', 'due=abc&period=2026-13&action=add'],
    ['a day out of range', 'due=abc&period=2026-10-32&action=add'],
    ['text', 'due=abc&period=soon&action=add'],
    ['a script', 'due=abc&period=<script>&action=add'],
  ])('ignores %s in the period', (_name, query) => {
    expect(parseDueLink(params(query))?.period).toBeNull();
  });

  it.each([
    ['slashes', 'due=../../etc/passwd'],
    ['markup', 'due=<img src=x onerror=alert(1)>'],
    ['spaces', 'due=a b'],
    ['something very long', `due=${'a'.repeat(65)}`],
    ['an empty id', 'due='],
  ])('rejects a bill id with %s', (_name, query) => {
    expect(parseDueLink(params(query))).toBeNull();
  });
});

describe('withoutDueLink', () => {
  it('takes the reminder out of the address and keeps everything else', () => {
    const next = withoutDueLink(params('month=2026-09&due=abc&period=2026-10&action=add'));
    expect(next.toString()).toBe('month=2026-09');
  });

  it('leaves an address with no reminder as it was', () => {
    expect(withoutDueLink(params('month=2026-09')).toString()).toBe('month=2026-09');
  });
});
