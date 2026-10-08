import { afterEach, describe, expect, it } from 'vitest';
import { ConditionFailedError, getStore, setStore, type Store } from '..';
import { planPatch } from '../patch';

afterEach(() => { setStore(undefined); });

describe('ConditionFailedError', () => {
  it('carries the failing operation index', () => {
    const error = new ConditionFailedError(1);
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('ConditionFailedError');
    expect(error.failedIndex).toBe(1);
  });

  it('has no index for a single-item condition', () => {
    expect(new ConditionFailedError().failedIndex).toBeUndefined();
  });
});

describe('getStore and setStore', () => {
  it('throws a clear error before a store is set', () => {
    expect(() => getStore()).toThrow(/initStore/);
  });

  it('returns the store that was set and forgets it when cleared', () => {
    const fake = {} as Store;
    setStore(fake);
    expect(getStore()).toBe(fake);
    setStore(undefined);
    expect(() => getStore()).toThrow();
  });
});

describe('planPatch', () => {
  it('drops fields and defaults whose value is undefined', () => {
    const plan = planPatch({ a: 1, b: undefined }, { c: 2, d: undefined });
    expect(plan.fields).toEqual([['a', 1]]);
    expect(plan.defaults).toEqual([['c', 2]]);
  });

  it('keeps null values', () => {
    expect(planPatch({ a: null }).fields).toEqual([['a', null]]);
  });

  it('rejects a patch with nothing to set', () => {
    expect(() => planPatch({})).toThrow('patch needs at least one field');
    expect(() => planPatch({ a: undefined })).toThrow('patch needs at least one field');
  });

  it('rejects a name that is both a field and a default', () => {
    expect(() => planPatch({ a: 1 }, { a: 2 })).toThrow('both fields and defaults');
  });

  it('rejects patching the key attributes', () => {
    expect(() => planPatch({ PK: 'x' })).toThrow('key attribute');
    expect(() => planPatch({ ok: 1 }, { SK: 'x' })).toThrow('key attribute');
  });
});
