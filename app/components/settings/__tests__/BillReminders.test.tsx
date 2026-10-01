import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MantineProvider } from '@mantine/core';
import { PREFERENCES_KEY, readPreferences } from '~/lib/preferences';

const push = vi.hoisted(() => ({
  support: 'ready' as string,
  enable: vi.fn(),
  disable: vi.fn(),
  update: vi.fn(),
}));

vi.mock('~/lib/queries', () => ({ useApi: () => ({ savePushSubscription: vi.fn(), deletePushSubscription: vi.fn() }) }));
vi.mock('~/lib/push', () => ({
  pushSupport: () => push.support,
  enableReminders: push.enable,
  disableReminders: push.disable,
  updateReminderSettings: push.update,
}));

import { BillReminders } from '../BillReminders';

function renderCard() {
  return render(<MantineProvider><BillReminders /></MantineProvider>);
}

// Every select lists all 24 hours, so pick from the list that belongs to the one clicked.
async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string): Promise<void> {
  const select = screen.getByLabelText(label, { selector: 'input' });
  await user.click(select);
  const list = document.getElementById(select.getAttribute('aria-controls') ?? '') as HTMLElement;
  await user.click(await within(list).findByRole('option', { name: option, hidden: true }));
}

const toggle = () => screen.getByRole('switch', { name: /^Remind me about bills/ });

beforeEach(() => {
  window.localStorage.clear();
  push.support = 'ready';
  push.enable.mockReset();
  push.enable.mockResolvedValue({ ok: true });
  push.disable.mockReset();
  push.disable.mockResolvedValue(true);
  push.update.mockReset();
  push.update.mockResolvedValue(true);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('BillReminders', () => {
  it('is off by default, and asks for nothing until it is turned on', () => {
    renderCard();
    expect(toggle()).not.toBeChecked();
    expect(push.enable).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Time of day')).not.toBeInTheDocument();
  });

  it('says plainly what it does and that it is optional', () => {
    renderCard();
    expect(screen.getByText(/A notification on this device when a bill is due, asking if you want to add it\. Off unless you turn it on\./)).toBeInTheDocument();
  });

  it('turns on with the default time and quiet hours, and remembers it', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(toggle());

    expect(push.enable).toHaveBeenCalledWith(expect.anything(), { hour: 8, quietHours: true, quietStart: 22, quietEnd: 7 });
    await waitFor(() => expect(toggle()).toBeChecked());
    expect(readPreferences(window.localStorage).billReminders).toBe(true);
  });

  it('then offers the time of day and quiet hours', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ billReminders: true }));
    renderCard();
    expect(screen.getByLabelText('Time of day', { selector: 'input' })).toHaveValue('08:00');
    expect(screen.getByLabelText('Quiet from', { selector: 'input' })).toHaveValue('22:00');
    expect(screen.getByLabelText('Quiet until', { selector: 'input' })).toHaveValue('07:00');
  });

  it('stays off, and says why, when notifications are blocked', async () => {
    push.enable.mockResolvedValue({ ok: false, reason: 'denied' });
    const user = userEvent.setup();
    renderCard();

    await user.click(toggle());

    expect(await screen.findByRole('alert')).toHaveTextContent("Notifications are blocked for this site. Allow them in your browser's settings, then try again.");
    expect(toggle()).not.toBeChecked();
    expect(readPreferences(window.localStorage).billReminders).toBe(false);
  });

  it('stays off, and says so calmly, when it could not be turned on', async () => {
    push.enable.mockResolvedValue({ ok: false, reason: 'failed' });
    const user = userEvent.setup();
    renderCard();

    await user.click(toggle());

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not turn on reminders. Check your connection and try again.');
    expect(toggle()).not.toBeChecked();
  });

  it('turns off, and stops asking the device', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ billReminders: true }));
    const user = userEvent.setup();
    renderCard();

    await user.click(toggle());

    expect(push.disable).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(toggle()).not.toBeChecked());
    expect(readPreferences(window.localStorage).billReminders).toBe(false);
  });

  it('is off on this device even if the server could not be told', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ billReminders: true }));
    push.disable.mockResolvedValue(false);
    const user = userEvent.setup();
    renderCard();

    await user.click(toggle());

    await waitFor(() => expect(readPreferences(window.localStorage).billReminders).toBe(false));
  });

  it('saves a new time of day straight away', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ billReminders: true }));
    const user = userEvent.setup();
    renderCard();

    await choose(user, 'Time of day', '18:00');

    expect(push.update).toHaveBeenCalledWith(expect.anything(), { hour: 18, quietHours: true, quietStart: 22, quietEnd: 7 });
    expect(readPreferences(window.localStorage).reminderHour).toBe(18);
  });

  it('saves turning quiet hours off, and then hides their times', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ billReminders: true }));
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('switch', { name: /^Quiet hours/ }));

    expect(push.update).toHaveBeenCalledWith(expect.anything(), { hour: 8, quietHours: false, quietStart: 22, quietEnd: 7 });
    expect(screen.queryByLabelText('Quiet from')).not.toBeInTheDocument();
  });

  it('says so when a new time could not be saved, and keeps it on this device', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ billReminders: true }));
    push.update.mockResolvedValue(false);
    const user = userEvent.setup();
    renderCard();

    await choose(user, 'Time of day', '18:00');

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save that. Check your connection and try again.');
  });

  it('does not contact the server when a setting changes while reminders are off', async () => {
    window.localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ billReminders: false }));
    renderCard();
    expect(screen.queryByLabelText('Time of day')).not.toBeInTheDocument();
    expect(push.update).not.toHaveBeenCalled();
  });

  describe('where it cannot work', () => {
    it.each([
      ['needs-install', /add this app to your Home Screen first: tap Share, then Add to Home Screen/i],
      ['unsupported', /This browser can't show reminders/],
      ['not-configured', /Reminders have not been set up for this app yet/],
    ])('says so for %s, and cannot be switched on', (support, message) => {
      push.support = support;
      renderCard();
      expect(screen.getByText(message)).toBeInTheDocument();
      expect(toggle()).toBeDisabled();
    });

    it('explains iPhone installation in words, with no jargon', () => {
      push.support = 'needs-install';
      renderCard();
      expect(screen.getByText(/Reminders only work from the installed app\./)).toBeInTheDocument();
    });

    it('says nothing extra where it works', () => {
      renderCard();
      expect(screen.queryByText(/can't show reminders|not been set up|Home Screen/)).not.toBeInTheDocument();
    });
  });
});
