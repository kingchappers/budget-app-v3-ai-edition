import type { Icon } from '@tabler/icons-react';
import {
  IconHome, IconShoppingCart, IconCar, IconBolt, IconHeart, IconDeviceTv, IconShirt,
  IconSparkles, IconBook, IconToolsKitchen2, IconRefresh, IconPlane, IconGift, IconShield,
  IconBriefcase, IconCode, IconBuilding, IconCash, IconChartLine, IconCurrencyBitcoin,
  IconBuildingEstate, IconTrendingUp, IconCategory, IconTag,
} from '@tabler/icons-react';

const ICONS: Record<string, Icon> = {
  home: IconHome,
  'shopping-cart': IconShoppingCart,
  car: IconCar,
  bolt: IconBolt,
  heart: IconHeart,
  'device-tv': IconDeviceTv,
  shirt: IconShirt,
  sparkles: IconSparkles,
  book: IconBook,
  'tools-kitchen-2': IconToolsKitchen2,
  refresh: IconRefresh,
  plane: IconPlane,
  gift: IconGift,
  shield: IconShield,
  briefcase: IconBriefcase,
  code: IconCode,
  building: IconBuilding,
  cash: IconCash,
  'chart-line': IconChartLine,
  'currency-bitcoin': IconCurrencyBitcoin,
  'building-estate': IconBuildingEstate,
  'trending-up': IconTrendingUp,
  // 'tag' is the icon assigned to every user-created custom category
  // (see createCategory's default in app/routes/categories.tsx).
  tag: IconTag,
};

export function getCategoryIcon(iconName: string): Icon {
  return ICONS[iconName] ?? IconCategory;
}
