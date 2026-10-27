import { describe, it, expect, vi } from 'vitest';

vi.mock('~/components/layout/DefaultLayout', () => ({ DefaultLayout: () => null }));

import * as home from '../_index';
import * as about from '../about';
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
  ['Home', home, 'Home – Hoardwise'],
  ['Transactions', transactions, 'Transactions – Hoardwise'],
  ['Budgets', budgets, 'Budgets – Hoardwise'],
  ['Pots', pots, 'Pots – Hoardwise'],
  ['Categories', categories, 'Categories – Hoardwise'],
  ['Recurring', recurring, 'Recurring – Hoardwise'],
  ['Insights', insights, 'Insights – Hoardwise'],
  ['Accounts', accounts, 'Accounts – Hoardwise'],
  ['Settings', settings, 'Settings – Hoardwise'],
  ['About', about, 'About – Hoardwise'],
  ['Any other page', root, 'Hoardwise'],
];

describe('route titles', () => {
  it.each(cases)('%s exports a page title', (_name, route, title) => {
    expect(route.meta({} as never)).toEqual([{ title }]);
  });
});
