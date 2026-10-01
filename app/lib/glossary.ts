export type GlossaryKey =
  | 'spend'
  | 'income'
  | 'setAside'
  | 'takeOut'
  | 'pot'
  | 'target'
  | 'potGoal'
  | 'monthlyAmount'
  | 'autoContribute'
  | 'groupBills'
  | 'groupKnownCosts'
  | 'groupEveryday'
  | 'groupSaving'
  | 'accountKind'
  | 'accountType'
  | 'netWorth';

export interface GlossaryEntry {
  term: string;
  definition: string;
  example: string;
}

// Look terms up by key, never by display string, so a term can be renamed in
// one place without the help breaking.
export const GLOSSARY: Record<GlossaryKey, GlossaryEntry> = {
  spend: {
    term: 'Spend',
    definition: 'Money that left you, either from your everyday money or from a pot.',
    example: 'A £3.50 coffee, or £120 from your Holidays pot for a hotel.',
  },
  income: {
    term: 'Income',
    definition: 'Money that came in.',
    example: 'Your salary, or £20 a friend paid you back.',
  },
  setAside: {
    term: 'Set aside',
    definition: 'Money you move into a pot to keep for later, rather than spend.',
    example: '£50 into your Holidays pot.',
  },
  takeOut: {
    term: 'Take out',
    definition: 'Money you move back out of a pot into your everyday money.',
    example: '£50 back out of Holidays because you no longer need it.',
  },
  pot: {
    term: 'Pot',
    definition: 'A named amount of money kept apart for something, so it does not get mixed up with everyday money.',
    example: 'A pot called Holidays, or one called Car repairs.',
  },
  target: {
    term: 'Target',
    definition: 'The most you plan to spend on a category, each month or each week.',
    example: '£300 a month for Food & Groceries.',
  },
  potGoal: {
    term: 'Pot goal',
    definition: 'The optional amount you want a pot to reach.',
    example: '£1,200 for a holiday.',
  },
  monthlyAmount: {
    term: 'Monthly amount',
    definition: 'How much you plan to put into a pot each month.',
    example: '£100 a month into Holidays.',
  },
  autoContribute: {
    term: 'Auto-contribute',
    definition: 'Adds the monthly amount to the pot for you each month, so you do not have to enter it.',
    example: 'Holidays grows by £100 on its own each month.',
  },
  groupBills: {
    term: 'Bills',
    definition: 'Costs that come around regularly and are usually the same each time.',
    example: 'Rent, broadband, phone.',
  },
  groupKnownCosts: {
    term: 'Saving for known costs',
    definition: 'Costs you know are coming but not exactly when, so you put a little aside as you go.',
    example: 'Car insurance, a holiday, Christmas.',
  },
  groupEveryday: {
    term: 'Everyday Spending',
    definition: 'Day-to-day spending that changes from week to week.',
    example: 'Food, transport, coffee.',
  },
  groupSaving: {
    term: 'Saving & Investment',
    definition: 'Money you are building up for the longer term.',
    example: 'A savings account or a pension.',
  },
  accountKind: {
    term: 'Kind',
    definition: 'Whether the account holds money you have (an asset) or money you owe (a liability).',
    example: 'A current account is an asset. A credit card is a liability.',
  },
  accountType: {
    term: 'Account type',
    definition: 'What sort of account it is, which only helps you tell your accounts apart.',
    example: 'Cash, Savings, Credit card.',
  },
  netWorth: {
    term: 'Net worth',
    definition: 'What you have minus what you owe, across all your accounts.',
    example: '£5,000 in savings minus a £1,000 credit card is £4,000.',
  },
};

export const GLOSSARY_KEYS = Object.keys(GLOSSARY) as GlossaryKey[];
