import type { TextSize } from './preferences';

export const TEXT_SIZE_OPTIONS: { value: TextSize; label: string }[] = [
  { value: 'standard', label: 'Standard' },
  { value: 'large', label: 'Large' },
  { value: 'largest', label: 'Largest' },
];

// The share of the browser's own text size used as the root size. The sizes in app.css match.
export const TEXT_SIZE_PERCENT: Record<TextSize, number> = { standard: 100, large: 112.5, largest: 125 };

export const PREFERENCES_STORAGE_KEY = 'budget.preferences';

// Runs before the page paints, so a larger size does not flash at the standard one first.
export const TEXT_SIZE_SCRIPT = `try{var p=JSON.parse(localStorage.getItem('${PREFERENCES_STORAGE_KEY}')||'{}');if(p.textSize==='large'||p.textSize==='largest'){document.documentElement.setAttribute('data-text-size',p.textSize)}}catch(e){}`;
