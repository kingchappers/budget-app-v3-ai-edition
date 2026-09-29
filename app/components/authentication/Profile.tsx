import { useAuth0 } from "@auth0/auth0-react";
import { Box, Avatar, Menu, Switch, UnstyledButton } from '@mantine/core';
import { IconLogout, IconUser } from '@tabler/icons-react';
import { useState } from 'react';
import { readOpenOnLaunch, safeStorage, writeOpenOnLaunch } from '~/lib/launchIntent';

function initialsFor(name?: string, email?: string): string {
  const source = name?.trim() || email?.trim() || '';
  if (!source) return '';
  const words = source.split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[words.length - 1][0]).toUpperCase();
  return source.slice(0, 2).toUpperCase();
}

export const Profile = () => {
  const { user, isAuthenticated, isLoading, logout } = useAuth0();
  const [openOnLaunch, setOpenOnLaunch] = useState<boolean>(() => readOpenOnLaunch(safeStorage('local')));

  if (isLoading) {
    return <div className="loading-text">Loading profile...</div>;
  }

  return (
    isAuthenticated && user ? (
        <Menu withArrow>
          <Menu.Target>
            <UnstyledButton>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.5rem', margin: '0rem' }}>
                {user.picture ? (
                  <img
                    src={user.picture}
                    alt={user.name || 'User'}
                    className="profile-picture"
                    style={{
                      width: '2.2rem',
                      height: '2.2rem',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '3px solid var(--mantine-color-primary-6)'
                    }}
                  />
                ) : (
                  <Avatar
                    radius="xl"
                    color="primary"
                    size="2.2rem"
                    style={{ border: '3px solid var(--mantine-color-primary-6)' }}
                  >
                    {initialsFor(user.name, user.email) || <IconUser size={16} />}
                  </Avatar>
                )}
                {/* The name/email pair has no width limit and a real
                    Auth0 identifier can run 40+ characters -- on a phone-
                    width header that overflows past the toggle and title.
                    Full detail is still one tap away via the dropdown. */}
                <Box visibleFrom="sm" style={{ textAlign: 'center' }}>
                  <div className="profile-name" style={{ fontSize: '0.75rem', fontWeight: '600', color: 'var(--mantine-color-text)', marginBottom: '0.1rem' }}>
                    {user.name}
                  </div>
                  <div className="profile-email" style={{ fontSize: '0.6rem', color: 'var(--mantine-color-dimmed)' }}>
                    {user.email}
                  </div>
                </Box>
              </div>
            </UnstyledButton>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Label hiddenFrom="sm">{user.email}</Menu.Label>
            <Menu.Label>Application</Menu.Label>
            <Menu.Item leftSection={<IconUser size={14} />}>
              Profile
            </Menu.Item>
            <Menu.Divider />
            <Box px="sm" py={6}>
              <Switch
                label="Open Add sheet on launch"
                description="Installed app only"
                checked={openOnLaunch}
                onChange={event => {
                  const checked = event.currentTarget.checked;
                  setOpenOnLaunch(checked);
                  writeOpenOnLaunch(safeStorage('local'), checked);
                }}
              />
            </Box>
            <Menu.Divider />
            <Menu.Item onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })} component="button" leftSection={<IconLogout size={14} />}>
              Logout
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
    ) : null
  );
};

export default Profile;