import { Stack } from '@mantine/core';
import { NavLink } from 'react-router';
import { IconCalendarCheck, IconRepeat, IconTag, IconChartBar, IconWallet, IconTrash } from '@tabler/icons-react';
import { ResponsiveSheet } from './ResponsiveSheet';
import { useNavTarget } from '~/hooks/useNavTarget';

export const MORE_ITEMS = [
  { to: '/catch-up', label: 'Catch up', Icon: IconCalendarCheck },
  { to: '/categories', label: 'Categories', Icon: IconTag },
  { to: '/recurring', label: 'Recurring', Icon: IconRepeat },
  { to: '/insights', label: 'Insights', Icon: IconChartBar },
  { to: '/accounts', label: 'Accounts', Icon: IconWallet },
  { to: '/deleted', label: 'Recently deleted', Icon: IconTrash },
];

export function MoreSheet({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const navTarget = useNavTarget();
  return (
    <ResponsiveSheet opened={opened} onClose={onClose} title="More">
      <Stack gap={0}>
        {MORE_ITEMS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={navTarget(to)}
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
