import { useEffect } from 'react';
import { usePreferences } from '~/lib/preferences';

// Applies the chosen text size to the page by setting an attribute that app.css scales the root by.
export function TextSize() {
  const [{ textSize }] = usePreferences();

  useEffect(() => {
    const root = document.documentElement;
    if (textSize === 'standard') root.removeAttribute('data-text-size');
    else root.setAttribute('data-text-size', textSize);
  }, [textSize]);

  return null;
}
