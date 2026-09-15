export function isConditionalCheckFailure(error: unknown): boolean {
  return error instanceof Error && error.name === 'ConditionalCheckFailedException';
}

export function isCancelledByCondition(error: unknown, index: number): boolean {
  if (!(error instanceof Error) || error.name !== 'TransactionCanceledException') return false;
  const reasons = (error as { CancellationReasons?: { Code?: string }[] }).CancellationReasons;
  return reasons?.[index]?.Code === 'ConditionalCheckFailed';
}
