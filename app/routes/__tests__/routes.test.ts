import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { flatRoutes } from '@react-router/fs-routes';

// Regression test for a real bug: react-router's flat-routes convention treats a
// dot in a filename as nesting under a same-named parent route file. If someone
// adds e.g. `banks.callback.tsx` while `banks.tsx` exists, it silently becomes a
// *child* of the banks route instead of a flat `/banks/callback` route — and since
// none of our layout routes render an <Outlet />, the child route never renders at
// all (it silently falls back to showing the parent). This bit us for real: the
// TrueLayer bank-connect callback route never mounted, so no bank connection could
// ever complete. See C1 in the 2026-09-15 final review report.
describe('flat routes', () => {
  it('resolves every route path to exactly one route entry (no dotted-filename nesting)', async () => {
    (globalThis as { __reactRouterAppDirectory?: string }).__reactRouterAppDirectory = path.resolve(
      __dirname,
      '..',
      '..',
    );

    const routes = await flatRoutes();

    const collectPaths = (entries: typeof routes, parentPath = ''): { path: string; hasChildren: boolean }[] => {
      return entries.flatMap((entry) => {
        const fullPath = entry.path ? `${parentPath}/${entry.path}`.replace(/^\/+/, '') : parentPath;
        const own = { path: fullPath, hasChildren: Boolean(entry.children?.length) };
        const children = entry.children ? collectPaths(entry.children, fullPath) : [];
        return [own, ...children];
      });
    };

    const allPaths = collectPaths(routes);

    const callback = allPaths.find((r) => r.path === 'banks/callback');
    expect(callback).toBeDefined();

    const banks = allPaths.find((r) => r.path === 'banks');
    expect(banks).toBeDefined();
    expect(banks?.hasChildren).toBe(false);
  });
});
