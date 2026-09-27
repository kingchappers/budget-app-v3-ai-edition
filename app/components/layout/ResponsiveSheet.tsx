import { Drawer, Modal, useMantineTheme } from '@mantine/core';
import { useMediaQuery } from '@mantine/hooks';

export interface ResponsiveSheetProps {
  opened: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}

export function ResponsiveSheet({ opened, onClose, title, children }: ResponsiveSheetProps) {
  const theme = useMantineTheme();
  const isDesktop = useMediaQuery(`(min-width: ${theme.breakpoints.sm})`);

  if (isDesktop) {
    return (
      <Modal opened={opened} onClose={onClose} title={title} centered size={440}>
        {children}
      </Modal>
    );
  }

  return (
    <Drawer
      opened={opened}
      onClose={onClose}
      position="bottom"
      size="auto"
      title={title}
      styles={{
        content: {
          flex: '0 0 auto',
          height: 'auto',
          maxHeight: '90dvh',
          borderTopLeftRadius: 'var(--mantine-radius-lg)',
          borderTopRightRadius: 'var(--mantine-radius-lg)',
        },
      }}
    >
      {children}
    </Drawer>
  );
}
