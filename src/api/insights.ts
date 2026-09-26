import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import { DEFAULT_CATEGORIES } from './defaults';
import { queryAll } from './dynamo';
import { computeInsights } from './insightsCalc';
import { isValidMonth, monthIndex, serverMonthIndex } from './months';
import type { ApiResponse, Category, Transaction } from './types';
import { ok, err } from './http';

export const MIN_INSIGHTS_MONTHS = 3;
export const MAX_INSIGHTS_MONTHS = 12;
export const DEFAULT_INSIGHTS_MONTHS = 6;

function parseMonths(value: string | undefined): number | null {
  if (value === undefined) return DEFAULT_INSIGHTS_MONTHS;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < MIN_INSIGHTS_MONTHS || parsed > MAX_INSIGHTS_MONTHS) return null;
  return parsed;
}

export async function getInsights(
  event: APIGatewayProxyEventV2,
  userId: string,
  _params: Record<string, string>,
): Promise<ApiResponse> {
  const asOf = event.queryStringParameters?.asOf;
  if (!isValidMonth(asOf) || monthIndex(asOf) > serverMonthIndex() + 1) {
    return err(400, 'asOf must be a month in YYYY-MM format, at most one month ahead');
  }

  const months = parseMonths(event.queryStringParameters?.months);
  if (months === null) {
    return err(400, `months must be an integer between ${MIN_INSIGHTS_MONTHS} and ${MAX_INSIGHTS_MONTHS}`);
  }

  const [customCategories, transactionItems] = await Promise.all([
    queryAll(userId, 'CAT#'),
    queryAll(userId, 'TXN#'),
  ]);
  const categories = [...DEFAULT_CATEGORIES, ...(customCategories as unknown as Category[])];

  const insights = computeInsights({
    transactions: transactionItems as unknown as Transaction[],
    categories,
    asOfMonth: asOf,
    months,
  });

  return ok(insights);
}
