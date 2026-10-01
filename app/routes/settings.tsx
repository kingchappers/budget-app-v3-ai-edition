import { Link } from 'react-router';
import { Card, Stack, Switch, Text, Title } from '@mantine/core';
import { IconChevronRight } from '@tabler/icons-react';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { usePreferences } from '~/lib/preferences';
import { pageTitle } from '~/lib/pageTitle';
import type { Route } from './+types/settings';

// Places that used to sit in the More menu. One way to each of them, from here.
const MANAGE_LINKS = [
  { to: '/categories', label: 'Categories', hint: 'Add, rename or remove spending and income categories.' },
  { to: '/accounts', label: 'Accounts', hint: 'Balances of your bank accounts, savings and debts.' },
  { to: '/deleted', label: 'Recently deleted', hint: 'Bring back something you removed.' },
  { to: '/catch-up', label: 'Catch up', hint: 'Add what you remember from the last few weeks.' },
];

function SettingsContent() {
  const [preferences, setPreferences] = usePreferences();

  return (
    <Stack maw={640}>
      <Title order={3}>Settings</Title>
      <Text size="sm" c="dimmed">Settings are saved on this device.</Text>

      <Card withBorder>
        <Title order={4} mb="sm">Manage</Title>
        <Stack gap={0}>
          {MANAGE_LINKS.map(({ to, label, hint }) => (
            <Link
              key={to}
              to={to}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                minHeight: 44, padding: '8px 0', textDecoration: 'none', color: 'inherit',
              }}
            >
              <span>
                <Text fw={500}>{label}</Text>
                <Text size="sm" c="dimmed">{hint}</Text>
              </span>
              <IconChevronRight size={18} aria-hidden />
            </Link>
          ))}
        </Stack>
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">Keyboard shortcut</Title>
        <Switch
          label="Press N to add a transaction"
          description="Turn this off if it opens the Add sheet when you don't mean it to, for example while using dictation."
          checked={preferences.shortcutN}
          onChange={event => setPreferences({ shortcutN: event.currentTarget.checked })}
        />
      </Card>

      <Card withBorder>
        <Title order={4} mb="sm">Installed app</Title>
        <Switch
          label="Open Add sheet when the installed app starts"
          description="Only applies when the app is installed on this device."
          checked={preferences.openAddOnLaunch}
          onChange={event => setPreferences({ openAddOnLaunch: event.currentTarget.checked })}
        />
      </Card>
    </Stack>
  );
}

export const meta: Route.MetaFunction = () => [{ title: pageTitle('Settings') }];

export default function Settings() {
  return (
    <DefaultLayout>
      <SettingsContent />
    </DefaultLayout>
  );
}
