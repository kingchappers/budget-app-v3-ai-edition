import { describe, it, expect } from 'vitest';
import { isCancelledByCondition, isConditionalCheckFailure } from '../dynamoErrors';

const named = (name: string, extra: object = {}) => Object.assign(new Error(name), { name, ...extra });

describe('isConditionalCheckFailure', () => {
  it('recognises ConditionalCheckFailedException', () => {
    expect(isConditionalCheckFailure(named('ConditionalCheckFailedException'))).toBe(true);
    expect(isConditionalCheckFailure(named('ValidationException'))).toBe(false);
  });
});

describe('isCancelledByCondition', () => {
  const cancelled = named('TransactionCanceledException', {
    CancellationReasons: [{ Code: 'None' }, { Code: 'ConditionalCheckFailed' }],
  });

  it('checks the cancellation reason at the given index', () => {
    expect(isCancelledByCondition(cancelled, 1)).toBe(true);
    expect(isCancelledByCondition(cancelled, 0)).toBe(false);
  });

  it('is false for other errors', () => {
    expect(isCancelledByCondition(new Error('boom'), 0)).toBe(false);
  });
});
