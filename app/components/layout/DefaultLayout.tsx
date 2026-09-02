import { useState } from 'react';
import { useDisclosure } from '@mantine/hooks';
import { ActionIcon, AppShell, Burger, Flex, Text, NavLink, Group, Paper } from '@mantine/core';
import { Auth0Provider } from '@auth0/auth0-react';
import Authentication from "../authentication/Authentication";
import { IconHome2, IconSettings, IconHome, IconList, IconTarget, IconPlus, IconTag } from '@tabler/icons-react';
import { NavLink as RouterNavLink, useLocation } from 'react-router';
import { TransactionSheet } from '../transactions/TransactionSheet';
import { currentYearMonth } from '~/lib/months';

const TABS = [
  { to: '/', label: 'Home', Icon: IconHome },
  { to: '/transactions', label: 'Transactions', Icon: IconList },
  { to: '/targets', label: 'Targets', Icon: IconTarget },
];

function BottomTabs() {
  const { pathname } = useLocation();
  return (
    <Paper
      component="nav"
      withBorder
      style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 100 }}
      p="xs"
    >
      <Group justify="space-around">
        {TABS.map(({ to, label, Icon }) => {
          const active = to === '/' ? pathname === '/' : pathname.startsWith(to);
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

export function DefaultLayout({ children }: { children: React.ReactNode }) {
  const [mobileOpened, { toggle: toggleMobile }] = useDisclosure();
  const [desktopOpened, { toggle: toggleDesktop }] = useDisclosure(true);
  const [addOpen, setAddOpen] = useState(false);

  return (
    <Auth0Provider
      domain={import.meta.env.VITE_AUTH0_DOMAIN}
      clientId={import.meta.env.VITE_AUTH0_CLIENT_ID}
      authorizationParams={{
        redirect_uri: window.location.origin,
        audience: import.meta.env.VITE_AUTH0_AUDIENCE,
      }}
    >
      <AppShell
        padding="md"
        header={{ height: 60 }}
        navbar={{
          width: 300,
          breakpoint: 'sm',
          collapsed: { mobile: !mobileOpened, desktop: !desktopOpened },
        }}
      >
        <AppShell.Header bg="menu">
          <Flex mih={50}
            gap="md"
            justify="space-between"
            align="center"
            direction="row"
            wrap="wrap"
            p="md">
            <div className="flex gap-2 items-center">
              <Burger opened={mobileOpened} onClick={toggleMobile} hiddenFrom="sm" size="md" />
              <Burger opened={desktopOpened} onClick={toggleDesktop} visibleFrom="sm" size="md" />
              <Text>Menu</Text>
            </div>

            <div className=''>
              <Authentication />
            </div>
          </Flex>

        </AppShell.Header>
        <AppShell.Navbar p="md" bg="menu">
          <NavLink href="/"
            label="Home"
            leftSection={<IconHome2 size={16} stroke={1.5} />} />
          <NavLink href="/categories"
            label="Categories"
            leftSection={<IconTag size={16} stroke={1.5} />} />
          <NavLink href="/test"
            label="Test"
            leftSection={<IconSettings size={16} stroke={1.5} />} />
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