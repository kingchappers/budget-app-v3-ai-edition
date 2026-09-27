import { Stack } from '@mantine/core';
import { NavLink } from 'react-router';
import { IconRepeat, IconTag, IconChartBar, IconWallet } from '@tabler/icons-react';
import { ResponsiveSheet } from './ResponsiveSheet';

export const MORE_ITEMS = [
  { to: '/categories', label: 'Categories', Icon: IconTag },
  { to: '/recurring', label: 'Recurring', Icon: IconRepeat },
  { to: '/insights', label: 'Insights', Icon: IconChartBar },
  { to: '/accounts', label: 'Accounts', Icon: IconWallet },
];

export function MoreSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title="More">
      <Stack gap={0}>
        {MORE_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            onClick={onClose}
            style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 4px', textDecoration: 'none', color: 'inherit' }}
          >
            <Icon size={20} stroke={1.6} />
            {label}
          </NavLink>
        ))}
      </Stack>
    </ResponsiveSheet>
  );
}
