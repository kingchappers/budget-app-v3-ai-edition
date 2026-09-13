import { useState } from 'react';
import { ActionIcon, AppShell, Flex, Text, NavLink, Group, Paper } from '@mantine/core';
import { Auth0Provider } from '@auth0/auth0-react';
import Authentication from "../authentication/Authentication";
import { ColorSchemeToggle } from './ColorSchemeToggle';
import { IconHome, IconList, IconTarget, IconPlus, IconTag } from '@tabler/icons-react';
import { NavLink as RouterNavLink, useLocation } from 'react-router';
import { TransactionSheet } from '../transactions/TransactionSheet';
import { currentYearMonth } from '~/lib/months';

const NAV_ITEMS = [
  { to: '/', label: 'Home', Icon: IconHome },
  { to: '/transactions', label: 'Transactions', Icon: IconList },
  { to: '/targets', label: 'Targets', Icon: IconTarget },
  { to: '/categories', label: 'Categories', Icon: IconTag },
];

function isNavItemActive(pathname: string, to: string) {
  return to === '/' ? pathname === '/' : pathname.startsWith(to);
}

function BottomTabs() {
  const { pathname } = useLocation();
  return (
    <Paper
      component="nav"
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
      </Group>
    </Paper>
  );
}

function SidebarNav() {
  const { pathname } = useLocation();
  return (
    <>
      {NAV_ITEMS.map(({ to, label, Icon }) => (
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

export function DefaultLayout({ children }: { children: React.ReactNode }) {
  const [addOpen, setAddOpen] = useState(false);

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
      <AppShell
        padding="md"
        header={{ height: 60 }}
        navbar={{ width: 260, breakpoint: 'sm', collapsed: { mobile: true, desktop: false } }}
      >
        <AppShell.Header>
          <Flex h="100%" px="md" justify="space-between" align="center">
            <Text fw={700}>Budget</Text>
            <Group gap="sm">
              <ColorSchemeToggle />
              <Authentication />
            </Group>
          </Flex>
        </AppShell.Header>
        <AppShell.Navbar p="md">
          <SidebarNav />
        </AppShell.Navbar>

        <AppShell.Main pb={80}>
          {children}
        </AppShell.Main>
        <ActionIcon
          size={56} radius="xl" variant="filled" aria-label="Add transaction"
          onClick={() => setAddOpen(true)}
          style={{ position: 'fixed', right: 16, bottom: 84, zIndex: 101 }}
        >
          <IconPlus size={26} />
        </ActionIcon>
        <TransactionSheet opened={addOpen} onClose={() => setAddOpen(false)} yearMonth={currentYearMonth()} />
        <BottomTabs />
      </AppShell>
    </Auth0Provider>
  );
}
