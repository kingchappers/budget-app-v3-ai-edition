import { useCallback, useState } from 'react';
import { ActionIcon, AppShell, Flex, Text, NavLink, Group, Loader, Paper, Tooltip, UnstyledButton } from '@mantine/core';
import { useHotkeys } from '@mantine/hooks';
import { Auth0Provider, useAuth0 } from '@auth0/auth0-react';
import Authentication from "../authentication/Authentication";
import { ColorSchemeToggle } from './ColorSchemeToggle';
import { QuickEntryTips } from './QuickEntryTips';
import { IconHome, IconList, IconTarget, IconPlus, IconPigMoney, IconMenu2 } from '@tabler/icons-react';
import { NavLink as RouterNavLink, useLocation } from 'react-router';
import { TransactionSheet } from '../transactions/TransactionSheet';
import { LaunchIntent } from './LaunchIntent';
import { OfflineQueueBanner } from './OfflineQueueBanner';
import { currentYearMonth } from '~/lib/months';
import { MoreSheet, MORE_ITEMS } from './MoreSheet';
import { SignedOutPanel } from './SignedOutPanel';
import { isSessionEndedError, useSessionEnded } from '~/lib/session';
import { usePreferences } from '~/lib/preferences';

const NAV_ITEMS = [
  { to: '/', label: 'Home', Icon: IconHome },
  { to: '/transactions', label: 'Transactions', Icon: IconList },
  { to: '/targets', label: 'Targets', Icon: IconTarget },
  { to: '/pots', label: 'Pots', Icon: IconPigMoney },
];

function isNavItemActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname.startsWith(to);
}

function isMoreActive(pathname: string): boolean {
  return MORE_ITEMS.some(item => isNavItemActive(pathname, item.to));
}

function BottomTabs() {
  const { pathname } = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = isMoreActive(pathname);
  return (
    <>
      <Paper
        component="nav"
        aria-label="Primary"
        withBorder
        hiddenFrom="sm"
        style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100 }}
        p="xs"
      >
        <Group justify="space-around">
          {NAV_ITEMS.map(({ to, label, Icon }) => {
            const active = isNavItemActive(pathname, to);
            return (
              <RouterNavLink key={to} to={to} style={{ textDecoration: 'none' }} aria-label={label}>
                <Group gap={2} justify="center" style={{ flexDirection: 'column' }}>
                  <Icon size={22} stroke={active ? 2.4 : 1.6} />
                  <Text size="xs" fw={active ? 700 : 400}>{label}</Text>
                </Group>
              </RouterNavLink>
            );
          })}
          <UnstyledButton onClick={() => setMoreOpen(true)} aria-label="More">
            <Group gap={2} justify="center" style={{ flexDirection: 'column' }}>
              <IconMenu2 size={22} stroke={moreActive ? 2.4 : 1.6} />
              <Text size="xs" fw={moreActive ? 700 : 400}>More</Text>
            </Group>
          </UnstyledButton>
        </Group>
      </Paper>
      <MoreSheet opened={moreOpen} onClose={() => setMoreOpen(false)} />
    </>
  );
}

function SidebarNav() {
  const { pathname } = useLocation();
  return (
    <>
      {[...NAV_ITEMS, ...MORE_ITEMS].map(({ to, label, Icon }) => (
        <NavLink
          key={to}
          component={RouterNavLink}
          to={to}
          label={label}
          active={isNavItemActive(pathname, to)}
          leftSection={<Icon size={16} stroke={1.5} />}
        />
      ))}
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
            <QuickEntryTips />
            <ColorSchemeToggle />
            <Authentication />
          </Group>
        </Flex>
      </AppShell.Header>
      <AppShell.Navbar p="md">
        <SidebarNav />
      </AppShell.Navbar>

      {/* The floating "Add transaction" button sits at bottom:84 with a
          56px diameter, so its top edge reaches bottom:140 — pb must
          clear that or the last card on a page renders underneath it. */}
      <AppShell.Main pb={150}>
        <OfflineQueueBanner />
        <MainContent session={session}>{children}</MainContent>
      </AppShell.Main>
      {signedIn && (
        <>
          <Tooltip label={shortcutN ? 'Add transaction (N)' : 'Add transaction'} events={{ hover: true, focus: true, touch: false }}>
            <ActionIcon
              size={56} radius="xl" variant="filled" aria-label="Add transaction"
              onClick={() => setAddOpen(true)}
              style={{ position: 'fixed', right: 16, bottom: 84, zIndex: 101 }}
            >
              <IconPlus size={26} />
            </ActionIcon>
          </Tooltip>
          <TransactionSheet opened={addOpen} onClose={() => setAddOpen(false)} yearMonth={currentYearMonth()} />
        </>
      )}
      <LaunchIntent onOpenAdd={openAdd} />
      <BottomTabs />
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
