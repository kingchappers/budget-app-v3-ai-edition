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
  def('cat-car-maintenance', 'Car maintenance', 'EXPENSE', '🚗', 'SINKING_FUNDS'),
  def('cat-certifications', 'Certifications', 'EXPENSE', '🏆', 'SINKING_FUNDS'),
  def('cat-holidays', 'Holidays', 'EXPENSE', '✈️', 'SINKING_FUNDS'),
  def('cat-home-maintenance', 'Home maintenance', 'EXPENSE', '🛠️', 'SINKING_FUNDS'),
  def('cat-gifts', 'Gifts', 'EXPENSE', '🎁', 'SINKING_FUNDS'),
  def('cat-insurance', 'Insurance', 'EXPENSE', '📄', 'SINKING_FUNDS'),
  // EVERYDAY SPENDING
  def('cat-charity', 'Charity', 'EXPENSE', '💖', 'EVERYDAY'),
  def('cat-conference', 'Conference', 'EXPENSE', '👨‍💼', 'EVERYDAY'),
  def('cat-going-out', 'Going Out & Entertainment', 'EXPENSE', '🎡', 'EVERYDAY'),
  def('cat-groceries', 'Groceries', 'EXPENSE', '🛒', 'EVERYDAY'),
  def('cat-health', 'Health', 'EXPENSE', '🏥', 'EVERYDAY'),
  def('cat-pets', 'Pets', 'EXPENSE', '🐾', 'EVERYDAY'),
  def('cat-personal-spending', 'Personal Spending', 'EXPENSE', '🛍️', 'EVERYDAY'),
  def('cat-transport', 'Transport', 'EXPENSE', '🛞', 'EVERYDAY'),
  // SAVING & INVESTMENT (INVESTMENT type until pots replace it)
  def('cat-emergency-fund', 'Emergency fund', 'INVESTMENT', '😌', 'SAVING_INVESTMENT'),
  def('cat-garden-project', 'Garden Project', 'INVESTMENT', '🧑‍🌾', 'SAVING_INVESTMENT'),
  def('cat-investment', 'Investment', 'INVESTMENT', 'tag', 'SAVING_INVESTMENT'),
  def('cat-windows', 'Windows', 'INVESTMENT', '🪟', 'SAVING_INVESTMENT'),
  // INCOME (ungrouped)
  def('cat-salary', 'Salary', 'INCOME', 'briefcase'),
  def('cat-freelance', 'Freelance/Contract', 'INCOME', 'code'),
  def('cat-rental', 'Rental Income', 'INCOME', 'building'),
  def('cat-other-income', 'Other Income', 'INCOME', 'cash'),
];

export const DEFAULT_CATEGORY_IDS = new Set(DEFAULT_CATEGORIES.map(c => c.categoryId));
