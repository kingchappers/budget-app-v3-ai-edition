import { Card, Stack, Switch, Text, Title } from '@mantine/core';
import { DefaultLayout } from '~/components/layout/DefaultLayout';
import { usePreferences } from '~/lib/preferences';
import { SESSION_LIFETIME_TEXT } from '~/lib/sessionLifetime';
import { pageTitle } from '~/lib/pageTitle';
import type { Route } from './+types/settings';

function SettingsContent() {
  const [preferences, setPreferences] = usePreferences();

  return (
    <Stack maw={640}>
      <Title order={1} size="h3">Settings</Title>
      <Text size="sm" c="dimmed">Settings are saved on this device.</Text>

      <Card withBorder>
        <Title order={2} size="h4" mb="sm">Signing in</Title>
        <Text size="sm">{SESSION_LIFETIME_TEXT}</Text>
      </Card>

      <Card withBorder>
        <Title order={2} size="h4" mb="sm">Keyboard shortcut</Title>
        <Switch
          label="Press N to add a transaction"
          description="Turn this off if it opens the Add sheet when you don't mean it to, for example while using dictation."
          checked={preferences.shortcutN}
          onChange={event => setPreferences({ shortcutN: event.currentTarget.checked })}
        />
      </Card>

      <Card withBorder>
        <Title order={2} size="h4" mb="sm">Installed app</Title>
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
