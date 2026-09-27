import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { queryAll } from './pots';
import type { ApiResponse, Transaction } from './types';
import { ok, err } from './http';

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_SPAN_MONTHS = 24;

function monthIndex(yearMonth: string): number {
  const [year, month] = yearMonth.split('-').map(Number);
  return year * 12 + (month - 1);
}

export async function getTransactionsRange(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const { from, to } = event.queryStringParameters || {};

  if (!from || !MONTH_PATTERN.test(from) || !to || !MONTH_PATTERN.test(to)) {
    return err(400, 'from and to must be months in YYYY-MM format');
  }
  if (from > to) {
    return err(400, 'from must not be after to');
  }
  if (monthIndex(to) - monthIndex(from) + 1 > MAX_SPAN_MONTHS) {
    return err(400, `the range must be at most ${MAX_SPAN_MONTHS} months`);
  }

  const items = await queryAll(userId, 'TXN#');
  const transactions = (items as unknown as Transaction[]).filter(
    t => t.yearMonth >= from && t.yearMonth <= to,
  );
  return ok({ transactions });
}
