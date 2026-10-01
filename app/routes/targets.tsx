import { redirect } from 'react-router';
import { planPath } from '~/lib/planTabs';
import type { Route } from './+types/targets';

// Budgets used to be called targets. The old address still works and leads to the Budgets tab under Plan.
export function clientLoader({ request }: Route.ClientLoaderArgs) {
  throw redirect(planPath('budgets', new URL(request.url).search));
}

export default function Targets() {
  return null;
}
