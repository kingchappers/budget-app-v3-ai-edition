import { useSearchParams } from 'react-router';
import { Stack, Tabs, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { useDocumentTitle } from '~/hooks/useDocumentTitle';
import { isPlanTab, PLAN_TABS, type PlanTab } from '~/lib/planTabs';
import { pageTitle } from '~/lib/pageTitle';
import { PotsContent } from './pots';
import { RecurringContent } from './recurring';
import { TargetsContent } from './targets';
import type { Route } from './+types/plan';

function PlanContent() {
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: PlanTab = isPlanTab(requested) ? requested : 'targets';
  const label = PLAN_TABS.find(item => item.value === tab)?.label ?? 'Targets';
  useDocumentTitle(pageTitle('Plan', label));

  return (
    <Stack>
      <Title order={3}>Plan</Title>
      <Tabs
        value={tab}
        // Moving between tabs drops anything meant for the tab you left.
        onChange={value => { if (isPlanTab(value)) setParams({ tab: value }, { replace: true }); }}
        keepMounted={false}
      >
        <Tabs.List>
          {PLAN_TABS.map(item => (
            <Tabs.Tab key={item.value} value={item.value} style={{ minHeight: 44 }}>{item.label}</Tabs.Tab>
          ))}
        </Tabs.List>
        <Tabs.Panel value="targets" pt="md"><TargetsContent /></Tabs.Panel>
        <Tabs.Panel value="pots" pt="md"><PotsContent /></Tabs.Panel>
        <Tabs.Panel value="recurring" pt="md"><RecurringContent /></Tabs.Panel>
      </Tabs>
    </Stack>
  );
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Plan') }];

export default function Plan() {
  return (
    <DefaultLayout>
      <PlanContent />
    </DefaultLayout>
  );
}
