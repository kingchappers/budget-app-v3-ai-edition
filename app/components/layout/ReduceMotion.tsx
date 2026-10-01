import { useEffect } from 'react';
import { usePreferences } from '~/lib/preferences';

// Mirrors the "Reduce motion" setting onto <html> so app.css can switch
// animations off. Renders nothing.
export function ReduceMotion(): null {
  const [{ reduceMotion }] = usePreferences();

  useEffect(() => {
    document.documentElement.toggleAttribute('data-reduce-motion', reduceMotion);
    return () => document.documentElement.removeAttribute('data-reduce-motion');
  }, [reduceMotion]);

  return null;
}
