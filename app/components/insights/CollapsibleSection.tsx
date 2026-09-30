import type { ReactNode } from 'react';
import { Group, Title, UnstyledButton } from '@mantine/core';
import { IconChevronDown, IconChevronRight } from '@tabler/icons-react';
import { INSIGHTS_SECTIONS, usePreferences, type InsightsSection } from '~/lib/preferences';

// A heading that opens and closes its section, remembering which were left open.
export function CollapsibleSection({ id, title, children }: { id: InsightsSection; title: string; children: ReactNode }) {
  const [preferences, setPreferences] = usePreferences();
  const open = preferences.insightsOpenSections.includes(id);
  const bodyId = `insights-section-${id}`;

  function toggle(): void {
    const next = new Set(preferences.insightsOpenSections);
    if (open) next.delete(id);
    else next.add(id);
    setPreferences({ insightsOpenSections: INSIGHTS_SECTIONS.filter(section => next.has(section)) });
  }

  return (
    <section>
      <Title order={5} mt="md">
        <UnstyledButton
          onClick={toggle}
          aria-expanded={open}
          aria-controls={bodyId}
          style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minHeight: 44, font: 'inherit' }}
        >
          {open ? <IconChevronDown size={18} aria-hidden /> : <IconChevronRight size={18} aria-hidden />}
          <Group gap={0}>{title}</Group>
        </UnstyledButton>
      </Title>
      {open && <div id={bodyId}>{children}</div>}
    </section>
  );
}
