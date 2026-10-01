import { describe, expect, it } from 'vitest';
import { clientLoader as potsLoader } from '../pots';
import { clientLoader as recurringLoader } from '../recurring';
import { clientLoader as budgetsLoader } from '../budgets';
import { clientLoader as targetsLoader } from '../targets';

function redirectedTo(loader: (args: never) => unknown, url: string): string | null {
  try {
    loader({ request: new Request(url) } as never);
  } catch (thrown) {
    const response = thrown as Response;
    expect(response.status).toBe(302);
    return response.headers.get('Location');
  }
  return null;
}

describe('the old addresses lead to Plan', () => {
  it('sends /budgets to the Budgets tab', () => {
    expect(redirectedTo(budgetsLoader, 'http://localhost/budgets')).toBe('/plan?tab=budgets');
  });

  it('sends the old /targets address to the Budgets tab too', () => {
    expect(redirectedTo(targetsLoader, 'http://localhost/targets')).toBe('/plan?tab=budgets');
  });

  it('sends /pots to the Pots tab', () => {
    expect(redirectedTo(potsLoader, 'http://localhost/pots')).toBe('/plan?tab=pots');
  });

  it('sends /recurring to the Recurring tab', () => {
    expect(redirectedTo(recurringLoader, 'http://localhost/recurring')).toBe('/plan?tab=recurring');
  });

  it('keeps a pot to open, so an older link still lands on it', () => {
    expect(redirectedTo(potsLoader, 'http://localhost/pots?pot=holidays&monthly=3000')).toBe('/plan?tab=pots&pot=holidays&monthly=3000');
  });
});
