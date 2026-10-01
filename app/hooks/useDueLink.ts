import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router';
import { notifications } from '@mantine/notifications';
import { parseDueLink, withoutDueLink } from '~/lib/dueLink';
import type { DueItem } from '~/lib/recurring';

export interface DueLinkHandlers {
  add: (item: DueItem) => void;
  skip: (item: DueItem) => void;
}

// A reminder's Add or Skip button opens the app with the bill and the choice in the address.
// Once the due list has loaded this does that one thing, the usual way (so Undo is there as always),
// and takes the parameters back out of the address so a reload does not do it twice.
export function useDueLink(items: DueItem[], ready: boolean, handlers: DueLinkHandlers): void {
  const [params, setParams] = useSearchParams();
  const latest = useRef(handlers);
  latest.current = handlers;
  const handled = useRef<string | null>(null);

  useEffect(() => {
    const link = parseDueLink(params);
    if (!link || !ready) return;

    const key = `${link.recurringId}|${link.period}|${link.action}`;
    if (handled.current === key) return;
    handled.current = key;
    setParams(withoutDueLink(params), { replace: true });

    if (link.action === null) return;
    const item = items.find(candidate => candidate.recurring.recurringId === link.recurringId
      && (link.period === null || candidate.period === link.period));
    if (!item) {
      notifications.show({ message: 'That one is already taken care of.', autoClose: 5000 });
      return;
    }
    if (link.action === 'add') latest.current.add(item);
    else latest.current.skip(item);
  }, [params, ready, items, setParams]);
}
