import { useState } from 'react';
import { Card, Group, Select, Stack, Switch, Text, Title } from '@mantine/core';
import { usePreferences } from '~/lib/preferences';
import { useApi } from '~/lib/queries';
import { disableReminders, enableReminders, pushSupport, updateReminderSettings, type PushSupport, type ReminderSettings } from '~/lib/push';

const HOURS = Array.from({ length: 24 }, (_, hour) => ({ value: String(hour), label: `${String(hour).padStart(2, '0')}:00` }));

const SUPPORT_NOTES: Record<Exclude<PushSupport, 'ready'>, string> = {
  'not-configured': 'Reminders have not been set up for this app yet.',
  'needs-install': 'On iPhone and iPad, add this app to your Home Screen first: tap Share, then Add to Home Screen. Reminders only work from the installed app.',
  unsupported: "This browser can't show reminders.",
};

const DENIED = "Notifications are blocked for this site. Allow them in your browser's settings, then try again.";
const FAILED = 'Could not turn on reminders. Check your connection and try again.';
const NOT_SAVED = 'Could not save that. Check your connection and try again.';

// Off until someone turns it on. Asking the browser for permission happens only then.
export function BillReminders() {
  const [preferences, setPreferences] = usePreferences();
  const api = useApi();
  const support = pushSupport();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function settingsWith(change: Partial<ReminderSettings> = {}): ReminderSettings {
    return {
      hour: preferences.reminderHour,
      quietHours: preferences.quietHours,
      quietStart: preferences.quietStart,
      quietEnd: preferences.quietEnd,
      ...change,
    };
  }

  async function turnOn(): Promise<void> {
    setBusy(true);
    setMessage(null);
    const result = await enableReminders(api, settingsWith());
    setBusy(false);
    if (result.ok) {
      setPreferences({ billReminders: true });
      return;
    }
    setMessage(result.reason === 'denied' ? DENIED : FAILED);
  }

  async function turnOff(): Promise<void> {
    setBusy(true);
    setMessage(null);
    await disableReminders(api);
    setBusy(false);
    setPreferences({ billReminders: false });
  }

  async function change(patch: Partial<typeof preferences>, settings: Partial<ReminderSettings>): Promise<void> {
    setPreferences(patch);
    if (!preferences.billReminders) return;
    setMessage(null);
    const saved = await updateReminderSettings(api, settingsWith(settings));
    if (!saved) setMessage(NOT_SAVED);
  }

  const on = preferences.billReminders;

  return (
    <Card withBorder>
      <Title order={4} mb="sm">Reminders</Title>
      <Stack gap="md">
        <Switch
          label="Remind me about bills"
          description="A notification on this device when a bill is due, asking if you want to add it. Off unless you turn it on."
          checked={on}
          disabled={support !== 'ready' || busy}
          onChange={event => { void (event.currentTarget.checked ? turnOn() : turnOff()); }}
        />
        {support !== 'ready' && <Text size="sm">{SUPPORT_NOTES[support]}</Text>}
        {message && <Text size="sm" role="alert">{message}</Text>}

        {on && (
          <>
            <Select
              label="Time of day"
              description="Reminders arrive at this time, in your own time zone."
              data={HOURS}
              value={String(preferences.reminderHour)}
              allowDeselect={false}
              onChange={value => { if (value !== null) void change({ reminderHour: Number(value) }, { hour: Number(value) }); }}
            />
            <Switch
              label="Quiet hours"
              description="No reminders in these hours. One due in them waits until they end."
              checked={preferences.quietHours}
              onChange={event => void change({ quietHours: event.currentTarget.checked }, { quietHours: event.currentTarget.checked })}
            />
            {preferences.quietHours && (
              <Group grow align="flex-start">
                <Select
                  label="Quiet from"
                  data={HOURS}
                  value={String(preferences.quietStart)}
                  allowDeselect={false}
                  onChange={value => { if (value !== null) void change({ quietStart: Number(value) }, { quietStart: Number(value) }); }}
                />
                <Select
                  label="Quiet until"
                  data={HOURS}
                  value={String(preferences.quietEnd)}
                  allowDeselect={false}
                  onChange={value => { if (value !== null) void change({ quietEnd: Number(value) }, { quietEnd: Number(value) }); }}
                />
              </Group>
            )}
          </>
        )}
      </Stack>
    </Card>
  );
}
