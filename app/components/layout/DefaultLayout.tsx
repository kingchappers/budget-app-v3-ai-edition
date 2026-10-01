import { useCallback, useState } from 'react';
import { ActionIcon, AppShell, Button, Flex, Text, NavLink, Group, Loader, Paper, Tooltip, UnstyledButton } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import Authentication from "../authentication/Authentication";
import { ColorSchemeToggle } from './ColorSchemeToggle';
import { QuickEntryTips } from './QuickEntryTips';
import { IconChartBar, IconHome, IconList, IconPlus, IconSettings, IconTarget } from '@tabler/icons-react';
import { Link, NavLink as RouterNavLink, useLocation } from 'react-router';
import { TransactionSheet } from '../transactions/TransactionSheet';
import { LaunchIntent } from './LaunchIntent';
import { OfflineQueueBanner } from './OfflineQueueBanner';
import { currentYearMonth } from '~/lib/months';
import { SignedOutPanel } from './SignedOutPanel';
import { isSessionEndedError, useSessionEnded } from '~/lib/session';
import { usePreferences } from '~/lib/preferences';
import { useNavTarget } from '~/hooks/useNavTarget';

// The same four places on every device. Add and Settings sit beside them, not among them.
export const NAV_ITEMS = [
  { to: '/', label: 'Home', Icon: IconHome },
  { to: '/transactions', label: 'Transactions', Icon: IconList },
  { to: '/plan', label: 'Plan', Icon: IconTarget },
  { to: '/insights', label: 'Insights', Icon: IconChartBar },
];

function isNavItemActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname.startsWith(to);
}

// Settings also covers the pages kept under "Manage".
const SETTINGS_PATHS = ['/settings', '/categories', '/accounts', '/deleted', '/catch-up'];

function isSettingsActive(pathname: string): boolean {
  return SETTINGS_PATHS.some(path => pathname.startsWith(path));
}

// An active tab is bold and has a bar above it, so it is not told apart by colour alone.
function TabLink({ to, label, Icon, active }: { to: string; label: string; Icon: typeof IconHome; active: boolean }) {
  return (
    <RouterNavLink to={to} style={{ textDecoration: 'none', minWidth: 0, minHeight: 44, flex: '1 1 0' }} aria-label={label}>
      <Group gap={2} justify="center" style={{ flexDirection: 'column' }}>
        <span
          aria-hidden
          style={{ height: 3, width: 24, borderRadius: 2, background: active ? 'currentColor' : 'transparent' }}
        />
        <Icon size={22} stroke={active ? 2.4 : 1.6} />
        <Text size="xs" fw={active ? 700 : 400} className="tab-label">{label}</Text>
      </Group>
    </RouterNavLink>
  );
}

function BottomTabs({ signedIn, onAdd }: { signedIn: boolean; onAdd: () => void }) {
  const { pathname } = useLocation();
  const navTarget = useNavTarget();
  const [first, second, ...rest] = NAV_ITEMS;
  const tab = ({ to, label, Icon }: typeof first) => (
    <TabLink key={to} to={navTarget(to)} label={label} Icon={Icon} active={isNavItemActive(pathname, to)} />
  );

  return (
    <Paper
      component="nav"
      aria-label="Primary"
      withBorder
      hiddenFrom="sm"
      // The height is shared with the page padding, scroll padding and toasts (see app.css).
      style={{
        position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100,
        height: 'var(--tab-bar-height)', paddingBottom: 'env(safe-area-inset-bottom, 0px)',
      }}
    >
      <Group justify="space-around" align="center" wrap="nowrap" gap={0} h="100%" px={4}>
        {tab(first)}
        {tab(second)}
        {signedIn && (
          <UnstyledButton onClick={onAdd} aria-label="Add transaction" style={{ minWidth: 0, minHeight: 44, flex: '1 1 0' }}>
            <Group gap={2} justify="center" style={{ flexDirection: 'column' }}>
              <ActionIcon component="span" size={40} radius="xl" variant="filled" aria-hidden>
                <IconPlus size={22} />
              </ActionIcon>
              <Text size="xs" fw={700} className="tab-label">Add</Text>
            </Group>
          </UnstyledButton>
        )}
        {rest.map(tab)}
      </Group>
    </Paper>
  );
}

function SidebarNav() {
  const { pathname } = useLocation();
  const navTarget = useNavTarget();
  return (
    <>
      {NAV_ITEMS.map(({ to, label, Icon }) => {
        const active = isNavItemActive(pathname, to);
        return (
          <NavLink
            key={to}
            component={RouterNavLink}
            to={navTarget(to)}
            label={label}
            active={active}
            leftSection={<Icon size={16} stroke={1.5} />}
            // Bold with a bar at the edge, in addition to the highlight.
            styles={{ label: { fontWeight: active ? 700 : 400 } }}
            style={{ borderLeft: `3px solid ${active ? 'currentColor' : 'transparent'}`, minHeight: 44 }}
          />
        );
      })}
    </>
  );
}

type SessionState = 'loading' | 'signedIn' | 'signedOut' | 'sessionEnded';

function useSessionState(): SessionState {
  const { isAuthenticated, isLoading, error } = useAuth0();
  const tokenRenewalFailed = useSessionEnded();
  const [hadSession, setHadSession] = useState(false);
  if (isAuthenticated && !hadSession) setHadSession(true);

  if (isLoading) return 'loading';
  if (tokenRenewalFailed) return 'sessionEnded';
  if (isAuthenticated) return 'signedIn';
  if (hadSession || isSessionEndedError(error)) return 'sessionEnded';
  return 'signedOut';
}

function MainContent({ session, children }: { session: SessionState; children: React.ReactNode }) {
  if (session === 'loading') {
    return (
      <Group justify="center" py="xl" role="status" aria-label="Checking your session">
        <Loader />
      </Group>
    );
  }
  if (session === 'signedIn') return <>{children}</>;
  return <SignedOutPanel sessionEnded={session === 'sessionEnded'} />;
}

function SettingsLink() {
  const { pathname } = useLocation();
  const active = isSettingsActive(pathname);
  return (
    <Tooltip label="Settings">
      <ActionIcon
        component={Link}
        to="/settings"
        // Settings also stands for the pages under Manage, so the current page is set by hand.
        aria-current={active ? 'page' : undefined}
        variant={active ? 'light' : 'subtle'}
        size={44}
        aria-label="Settings"
        // A ring as well as the tint, so the current page is not shown by colour alone.
        style={{ outline: active ? '2px solid currentColor' : undefined, outlineOffset: -2 }}
      >
        <IconSettings size={22} />
      </ActionIcon>
    </Tooltip>
  );
}

function LayoutShell({ children }: { children: React.ReactNode }) {
  const [addOpen, setAddOpen] = useState(false);
  const openAdd = useCallback(() => setAddOpen(true), []);
  const [{ shortcutN }] = usePreferences();
  const session = useSessionState();
  const signedIn = session === 'signedIn';

  useHotkeys(shortcutN && signedIn ? [['n', () => {
    if (document.querySelector('[role="dialog"]')) return;
    setAddOpen(true);
  }]] : []);

  return (
    <AppShell
      padding="md"
      header={{ height: 60 }}
      navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: true, desktop: false } }}
    >
      <AppShell.Header>
        <Flex h="100%" px="md" justify="space-between" align="center">
          <Text fw={700}>Budget</Text>
          <Group gap="sm">
            {signedIn && (
              <Tooltip label={shortcutN ? 'Add transaction (N)' : 'Add transaction'} events={{ hover: true, focus: true, touch: false }}>
                <Button visibleFrom="sm" leftSection={<IconPlus size={18} />} onClick={openAdd}>Add transaction</Button>
              </Tooltip>
            )}
            <SettingsLink />
            <QuickEntryTips />
            <ColorSchemeToggle />
            <Authentication />
          </Group>
        </Flex>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <SidebarNav />
      </AppShell.Navbar>

      {/* Clears the phone tab bar, which is fixed to the bottom of the screen. */}
      <AppShell.Main style={{ paddingBottom: 'calc(var(--tab-bar-height) + var(--mantine-spacing-xl))' }}>
        <OfflineQueueBanner />
        <MainContent session={session}>{children}</MainContent>
      </AppShell.Main>
      {signedIn && <TransactionSheet opened={addOpen} onClose={() => setAddOpen(false)} yearMonth={currentYearMonth()} />}
      <LaunchIntent onOpenAdd={openAdd} />
      <BottomTabs signedIn={signedIn} onAdd={openAdd} />
    </AppShell>
  );
}

export function DefaultLayout({ children }: { children: React.ReactNode }) {
  return (
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      // The default in-memory cache forces a silent-auth iframe on every reload,
      // which browsers block as a third-party cookie. Persist instead and renew
      // with a rotating refresh token.
      cacheLocation="localstorage"
      useRefreshTokens
      useRefreshTokensFallback={false}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        scope: 'openid profile email offline_access',
      }}
    >
      <LayoutShell>{children}</LayoutShell>
    </Auth0Provider>
  );
}
