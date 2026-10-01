import type { UndoDuration } from './preferences';

export const UNDO_DURATION_OPTIONS: { value: UndoDuration; label: string }[] = [
  { value: 'until-closed', label: 'Until I close them' },
  { value: '30s', label: '30 seconds' },
  { value: '10s', label: '10 seconds' },
];

const SECONDS: Record<Exclude<UndoDuration, 'until-closed'>, number> = { '30s': 30, '10s': 10 };

// What Mantine's autoClose wants: false to stay until dismissed, else milliseconds.
export function undoAutoClose(duration: UndoDuration): number | false {
  return duration === 'until-closed' ? false : SECONDS[duration] * 1000;
}
