import type { Category } from './types';

export const DEFAULT_CATEGORIES: Category[] = [
  // EXPENSE
  { categoryId: 'cat-housing',       name: 'Housing',             type: 'EXPENSE',    icon: 'home',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-food',          name: 'Food & Groceries',    type: 'EXPENSE',    icon: 'shopping-cart', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-transport',     name: 'Transport',           type: 'EXPENSE',    icon: 'car',         isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-utilities',     name: 'Utilities',           type: 'EXPENSE',    icon: 'bolt',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-health',        name: 'Health & Medical',    type: 'EXPENSE',    icon: 'heart',       isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-entertainment', name: 'Entertainment',       type: 'EXPENSE',    icon: 'device-tv',   isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-clothing',      name: 'Clothing',            type: 'EXPENSE',    icon: 'shirt',       isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-personal-care', name: 'Personal Care',       type: 'EXPENSE',    icon: 'sparkles',    isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-education',     name: 'Education',           type: 'EXPENSE',    icon: 'book',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-dining',        name: 'Restaurants & Dining',type: 'EXPENSE',    icon: 'tools-kitchen-2', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-subscriptions', name: 'Subscriptions',       type: 'EXPENSE',    icon: 'refresh',     isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-travel',        name: 'Travel',              type: 'EXPENSE',    icon: 'plane',       isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-gifts',         name: 'Gifts & Donations',   type: 'EXPENSE',    icon: 'gift',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-insurance',     name: 'Insurance',           type: 'EXPENSE',    icon: 'shield',      isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  // INCOME
  { categoryId: 'cat-salary',        name: 'Salary',              type: 'INCOME',     icon: 'briefcase',   isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-freelance',     name: 'Freelance/Contract',  type: 'INCOME',     icon: 'code',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-rental',        name: 'Rental Income',       type: 'INCOME',     icon: 'building',    isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-other-income',  name: 'Other Income',        type: 'INCOME',     icon: 'cash',        isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  // INVESTMENT
  { categoryId: 'cat-stocks',        name: 'Stocks',              type: 'INVESTMENT', icon: 'chart-line',  isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-crypto',        name: 'Crypto',              type: 'INVESTMENT', icon: 'currency-bitcoin', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-real-estate',   name: 'Real Estate',         type: 'INVESTMENT', icon: 'building-estate', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
  { categoryId: 'cat-other-investments', name: 'Other Investments', type: 'INVESTMENT', icon: 'trending-up', isDefault: true, createdAt: '2026-01-01T00:00:00.000Z' },
];

export const DEFAULT_CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map(c => c.categoryId));
