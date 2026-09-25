import { getCategoryIcon, isEmojiIcon } from '~/lib/categoryIcons';

export function CategoryIcon({ icon, size = 18 }: { icon: string; size?: number }) {
  if (isEmojiIcon(icon)) {
    return <span aria-hidden="true" style={{ fontSize: size, lineHeight: 1 }}>{icon}</span>;
  }
  const Icon = getCategoryIcon(icon);
  return <Icon size={size} stroke={1.6} />;
}
