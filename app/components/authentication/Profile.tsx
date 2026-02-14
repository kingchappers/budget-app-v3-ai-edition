import { useAuth0 } from "@auth0/auth0-react";
import { Group, Avatar, Menu, UnstyledButton } from '@mantine/core';
import { IconChevronRight, IconLogout, IconUser } from '@tabler/icons-react';
import { forwardRef } from 'react';


interface UserButtonProps extends React.ComponentPropsWithoutRef<'button'> {
  image: React.ReactNode;
  name: string;
  email: string;
  icon?: React.ReactNode;
}

const UserButton = forwardRef<HTMLButtonElement, UserButtonProps>(
  ({ image, name, email, icon, ...others }: UserButtonProps, ref) =>
  (
    <UnstyledButton
      ref={ref}
      style={{
        padding: 'var(--mantine-spacing-md)',
        color: 'var(--mantine-color-text)',
        borderRadius: 'var(--mantine-radius-sm)',
      }}
      {...others}
    >
      <Group>
        <Avatar radius="xl" />

        <div style={{ flex: 1 }}>
          <p>
            {name}
          </p>

          <p>
            {email}
          </p>
        </div>

        {icon || <IconChevronRight size={16} />}
      </Group>
    </UnstyledButton>
  )
);

export const Profile = () => {
  const { user, isAuthenticated, isLoading, logout } = useAuth0();

  if (isLoading) {
    return <div className="loading-text">Loading profile...</div>;
  }

  return (
    isAuthenticated && user ? (
        <Menu withArrow>
          <Menu.Target>
            <UnstyledButton>
              <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '0.5rem', margin: '0rem' }}>
                {user.picture && (
                  <img
                    src={user.picture}
                    alt={user.name || 'User'}
                    className="profile-picture"
                    style={{
                      width: '2.2rem',
                      height: '2.2rem',
                      borderRadius: '50%',
                      objectFit: 'cover',
                      border: '3px solid #63b3ed'
                    }}
                  />
                )}
                <div style={{ textAlign: 'center' }}>
                  <div className="profile-name" style={{ fontSize: '0.75rem', fontWeight: '600', color: '#f7fafc', marginBottom: '0.1rem' }}>
                    {user.name}
                  </div>
                  <div className="profile-email" style={{ fontSize: '0.6rem', color: '#a0aec0' }}>
                    {user.email}
                  </div>
                </div>
              </div>
            </UnstyledButton>
          </Menu.Target>

          <Menu.Dropdown>
            <Menu.Label>Application</Menu.Label>
            <Menu.Item leftSection={<IconUser size={14} />}>
              Profile
            </Menu.Item>
            <Menu.Item onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })} component="button" leftSection={<IconLogout size={14} />}>
              Logout
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
    ) : null
  );
};

export default Profile;