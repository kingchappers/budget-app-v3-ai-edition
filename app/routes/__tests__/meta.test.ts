import { describe, it, expect, vi } from 'vitest';

vi.mock('~/components/layout/DefaultLayout', () => ({ DefaultLayout: () => null }));

import * as home from '../_index';
import * as accounts from '../accounts';
import * as categories from '../categories';
import * as insights from '../insights';
import * as pots from '../pots';
import * as recurring from '../recurring';
import * as settings from '../settings';
import * as budgets from '../budgets';
import * as transactions from '../transactions';
import * as root from '../../root';

interface RouteWithMeta {
  meta: (args: never) => unknown;
}

const cases: [string, RouteWithMeta, string][] = [
  ['Home', home, 'Home – Budget'],
  ['Transactions', transactions, 'Transactions – Budget'],
  ['Budgets', budgets, 'Budgets – Budget'],
  ['Pots', pots, 'Pots – Budget'],
  ['Categories', categories, 'Categories – Budget'],
  ['Recurring', recurring, 'Recurring – Budget'],
  ['Insights', insights, 'Insights – Budget'],
  ['Accounts', accounts, 'Accounts – Budget'],
  ['Settings', settings, 'Settings – Budget'],
  ['Any other page', root, 'Budget'],
];

describe('route titles', () => {
  it.each(cases)('%s exports a page title', (_name, route, title) => {
    expect(route.meta({} as never)).toEqual([{ title }]);
  });
});
