// Shared types and the category taxonomy (PRD §6.1).

export const ESSENTIAL_CATEGORIES = [
  'Rent',
  'EMI',
  'Utilities',
  'Groceries',
  'Insurance',
  'Family Support',
  'Transport',
] as const

export const FLEXIBLE_CATEGORIES = [
  'Dining',
  'Food delivery',
  'Shopping',
  'Entertainment',
  'Travel',
  'Subscriptions',
  'Other',
] as const

/** Money that moved but is not spending: never counted in burn or flexible spend. */
export const EXCLUDED_CATEGORIES = ['Self-transfer', 'CC repayment', 'P2P split', 'Ignored'] as const

export const INCOME_CATEGORIES = ['Salary', 'Other income'] as const

export type EssentialCategory = (typeof ESSENTIAL_CATEGORIES)[number]
export type FlexibleCategory = (typeof FLEXIBLE_CATEGORIES)[number]
export type ExcludedCategory = (typeof EXCLUDED_CATEGORIES)[number]
export type IncomeCategory = (typeof INCOME_CATEGORIES)[number]
export type Category = EssentialCategory | FlexibleCategory | ExcludedCategory | IncomeCategory

export const ALL_CATEGORIES: Category[] = [
  ...ESSENTIAL_CATEGORIES,
  ...FLEXIBLE_CATEGORIES,
  ...EXCLUDED_CATEGORIES,
  ...INCOME_CATEGORIES,
]

export type Bucket = 'essential' | 'flexible' | 'excluded' | 'income'

export function bucketOf(cat: Category): Bucket {
  if ((ESSENTIAL_CATEGORIES as readonly string[]).includes(cat)) return 'essential'
  if ((FLEXIBLE_CATEGORIES as readonly string[]).includes(cat)) return 'flexible'
  if ((EXCLUDED_CATEGORIES as readonly string[]).includes(cat)) return 'excluded'
  return 'income'
}

export const BUCKET_LABEL: Record<Bucket, string> = {
  essential: 'Essential',
  flexible: 'Flexible',
  excluded: 'Excluded',
  income: 'Income',
}

export type Source = 'csv' | 'pdf' | 'sms' | 'manual' | 'sample'
export type Direction = 'debit' | 'credit'
export type Flag =
  | 'self_transfer'
  | 'cc_repayment'
  | 'p2p_split'
  | 'recurring'
  | 'duplicate'
  | 'needs_review'

export type ReviewReason = 'uncategorized' | 'potential_p2p' | 'missing_date' | 'investment_like'

/** One imported record, stored exactly as parsed. Raw text is never discarded. */
export interface Txn {
  id: string
  source: Source
  statementType: 'bank' | 'card' | null
  bank: string | null
  accountMask: string | null
  /** ISO date YYYY-MM-DD */
  date: string
  postedDate: string | null
  rawDescription: string
  merchantGuess: string | null
  vpa: string | null
  reference: string | null
  /** Always positive. Direction says which way the money moved. */
  amount: number
  direction: Direction
  balanceAfter: number | null
  /** Baseline category from the deterministic sanitizer / merchant list. Rules sit on top of this. */
  autoCategory: Category | null
  /** Human-readable reason for the baseline classification. */
  autoReason: string
  autoConfidence: 'high' | 'medium' | 'low' | null
  /** Baseline flags from import time (self_transfer, cc_repayment, needs_review, duplicate). */
  flags: Flag[]
  reviewReason: ReviewReason | null
  importedAt: string
  batchId: string
}

/**
 * A user correction. "contains" rules apply to every matching transaction, past and future.
 * "txn" rules pin a single transaction (token = transaction id).
 */
export interface Rule {
  id: string
  matchType: 'contains' | 'txn'
  /** lowercase token matched against merchant + vpa + raw description, or a transaction id */
  token: string
  /** where a "contains" rule looks: everything (default), the merchant name only, or the UPI ID only */
  matchField?: 'any' | 'merchant' | 'vpa'
  category: Category
  /** manual split of one transaction across categories (txn rules); any remainder goes to `category` */
  splits?: { category: Category; amount: number }[]
  /**
   * Only for category "P2P split": the part of each matching debit that is the user's own share.
   * That share stays counted (under shareCategory); only the remainder is treated as noise.
   */
  myShare?: number
  shareCategory?: Category
  /** a short label shown in the rules library */
  label?: string
  createdAt: string
}

export type GoalType = 'custom' | 'debt'

export interface Goal {
  id: string
  name: string
  type: GoalType
  target: number | null
  saved: number | null
  /** the date the user wants to reach it by (optional) */
  targetDate: string | null
  /** null = share the surplus left after explicit contributions */
  monthlyContribution: number | null
}

export interface EmergencyFund {
  /** target = months × essential monthly burn, unless the user overrides it */
  months: number
  targetOverride: number | null
  /** null = accessible cash is the emergency fund */
  balance: number | null
  targetDate: string | null
  monthlyContribution: number | null
}

/** Shapes the wording of tips only. It never changes numbers or suggests products. */
export type RiskPreference = 'conservative' | 'balanced'

/** Monthly amounts the user can type in. null = "work it out from my statements". */
export interface ProfileLines {
  rent: number | null
  emi: number | null
  utilities: number | null
  groceries: number | null
  insurance: number | null
  familySupport: number | null
  transport: number | null
  /** total flexible spend per month */
  flexible: number | null
}

export interface Profile extends ProfileLines {
  takeHome: number | null
  /** day of month the salary lands (1-31) */
  payday: number | null
  accessibleCash: number | null
  includeFD: boolean
  fdAmount: number
  fdHaircutPct: number
  emergency: EmergencyFund
  goals: Goal[]
  risk: RiskPreference
  /** warn when survival runway drops below this many months */
  runwayAlertMonths: number
}

export interface SimState {
  /** cut all flexible spending by X% */
  cutPct: number
  /** cut one flexible category by X% (e.g. dining out) */
  catCut: { category: FlexibleCategory; pct: number }
  disabledLeaks: string[]
  rentStressPct: number
  emiStressPct: number
  /** months with no salary (0–3) */
  incomeGapMonths: number
  /** one-off emergency expense paid from cash */
  shockExpense: number
  /** new essential cost in rupees per month (e.g. rent up ₹3,500, parents need ₹4,000) */
  extraEssential: number
  extraEssentialLabel: string
}

export interface SavedScenario {
  id: string
  name: string
  sim: SimState
  createdAt: string
}

export type LeakDecision = 'keep' | 'cancel' | 'review'

export const PROFILE_LINE_KEYS: (keyof ProfileLines)[] = [
  'rent',
  'emi',
  'utilities',
  'groceries',
  'insurance',
  'familySupport',
  'transport',
  'flexible',
]

export const LINE_TO_CATEGORY: Record<Exclude<keyof ProfileLines, 'flexible'>, EssentialCategory> = {
  rent: 'Rent',
  emi: 'EMI',
  utilities: 'Utilities',
  groceries: 'Groceries',
  insurance: 'Insurance',
  familySupport: 'Family Support',
  transport: 'Transport',
}

export const DEFAULT_PROFILE: Profile = {
  takeHome: null,
  payday: null,
  accessibleCash: null,
  includeFD: false,
  fdAmount: 0,
  fdHaircutPct: 10,
  rent: null,
  emi: null,
  utilities: null,
  groceries: null,
  insurance: null,
  familySupport: null,
  transport: null,
  flexible: null,
  emergency: { months: 6, targetOverride: null, balance: null, targetDate: null, monthlyContribution: null },
  goals: [],
  risk: 'conservative',
  runwayAlertMonths: 3,
}

export const DEFAULT_SIM: SimState = {
  cutPct: 0,
  catCut: { category: 'Dining', pct: 0 },
  disabledLeaks: [],
  rentStressPct: 0,
  emiStressPct: 0,
  incomeGapMonths: 0,
  shockExpense: 0,
  extraEssential: 0,
  extraEssentialLabel: '',
}
