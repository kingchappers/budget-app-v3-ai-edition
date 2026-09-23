import { useEffect, useRef } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { captureAddParam, consumeLaunchIntent, isStandalone, safeStorage } from '~/lib/launchIntent';

export interface LaunchIntentProps {
  onOpenAdd: () => void;
}

export function LaunchIntent({ onOpenAdd }: LaunchIntentProps): null {
  const { isAuthenticated, isLoading } = useAuth0();
  const evaluated = useRef(false);

  useEffect(() => {
    const cleaned = captureAddParam(window.location, safeStorage('session'));
    if (cleaned !== null) window.history.replaceState(window.history.state, '', cleaned);
  }, []);

  useEffect(() => {
    if (isLoading || !isAuthenticated || evaluated.current) return;
    evaluated.current = true;
    const shouldOpen = consumeLaunchIntent({
      session: safeStorage('session'),
      local: safeStorage('local'),
      standalone: isStandalone(window),
    });
    if (shouldOpen) onOpenAdd();
  }, [isLoading, isAuthenticated, onOpenAdd]);

  return null;
}
