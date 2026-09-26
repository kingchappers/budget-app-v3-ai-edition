import type { Category, CategoryGroup, CategoryType } from './types';

const CREATED_AT = '2026-01-01T00:00:00.000Z';

function def(categoryId: string, name: string, type: CategoryType, icon: string, group?: CategoryGroup): Category {
  const category: Category = { categoryId, name, type, icon, isDefault: true, createdAt: CREATED_AT };
  if (group) category.group = group;
  return category;
}

export const DEFAULT_CATEGORIES: Category[] = [
  // BILLS
  def('cat-council-tax', 'Council Tax', 'EXPENSE', 'tag', 'BILLS'),
  def('cat-mortgage', 'Mortgage', 'EXPENSE', '🏠', 'BILLS'),
  def('cat-phone-internet', 'Phone and Internet', 'EXPENSE', '🛜', 'BILLS'),
  def('cat-subscriptions', 'Subscriptions', 'EXPENSE', '🗓️', 'BILLS'),
  def('cat-utilities', 'Utilities', 'EXPENSE', '⚡', 'BILLS'),
  // SINKING FUNDS
  def('cat-holidays', 'Holidays', 'POT', '✈️', 'SINKING_FUNDS'),
  def('cat-home-maintenance', 'Home maintenance', 'POT', '🛠️', 'SINKING_FUNDS'),
  def('cat-gifts', 'Gifts', 'POT', '🎁', 'SINKING_FUNDS'),
  def('cat-insurance', 'Insurance', 'POT', '📄', 'SINKING_FUNDS'),
  // EVERYDAY SPENDING
  def('cat-charity', 'Charity', 'EXPENSE', '💖', 'EVERYDAY'),
  def('cat-going-out', 'Going Out & Entertainment', 'EXPENSE', '🎡', 'EVERYDAY'),
  def('cat-groceries', 'Groceries', 'EXPENSE', '🛒', 'EVERYDAY'),
  def('cat-health', 'Health', 'EXPENSE', '🏥', 'EVERYDAY'),
  def('cat-personal-spending', 'Personal Spending', 'EXPENSE', '🛍️', 'EVERYDAY'),
  def('cat-transport', 'Transport', 'EXPENSE', '🛞', 'EVERYDAY'),
  // SAVING & INVESTMENT
  def('cat-emergency-fund', 'Emergency fund', 'POT', '😌', 'SAVING_INVESTMENT'),
  def('cat-investment', 'Investment', 'POT', 'tag', 'SAVING_INVESTMENT'),
  // INCOME (ungrouped)
  def('cat-salary', 'Salary', 'INCOME', 'briefcase'),
  def('cat-freelance', 'Freelance/Contract', 'INCOME', 'code'),
  def('cat-rental', 'Rental Income', 'INCOME', 'building'),
  def('cat-other-income', 'Other Income', 'INCOME', 'cash'),
];

export const DEFAULT_CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map(c => c.categoryId));
