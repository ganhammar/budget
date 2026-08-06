/** A month, formatted "2026-08". */
export type Month = string;

export type Role = 'admin' | 'member';

/** The household is the tenant. All budget data belongs to exactly one household. */
export interface Household {
  id: string;
  name: string;
  created: Month;
  /** Absent on households created before categories were editable. */
  categories?: string[];
}

/**
 * A member of the household. `invited` means the email is registered but the
 * person has not signed in yet, so they are excluded from the split.
 */
export type Language = 'sv' | 'en';
export type ThemeChoice = 'system' | 'light' | 'dark';

export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'invited';
  /** Baseline monthly income, used for future months and as a fallback. */
  baselineIncome: number;
  /** Absent means the defaults: the browser's language and the system theme. */
  language?: Language;
  theme?: ThemeChoice;
}

/**
 * Confirmed income for a specific month, overriding the member's baseline.
 * The presence of an entry is what marks a month as confirmed: a month with no
 * entry falls back to the baseline and counts as an estimate, which is not the
 * same as confirming that the income happened to equal the baseline.
 */
export interface IncomeEntry {
  memberId: string;
  month: Month;
  amount: number;
  /** Set when an admin recorded the figure on someone else's behalf. */
  enteredById?: string;
}

/**
 * A stretch during which a cost is live. `from` is inclusive and `to` is exclusive,
 * matching the one-off convention. Either end may be open: no `from` means it has
 * run since before anyone was counting, no `to` means it is still running.
 */
export interface ActivePeriod {
  from?: Month;
  to?: Month;
}

/**
 * A recurring cost. `amount` is what gets charged each time and `intervalMonths`
 * how often. The budgeted monthly figure is amount / intervalMonths, while the
 * actual withdrawal happens in the months implied by `firstCharge`.
 */
/**
 * What a cost charges and who pays it, from a given month onwards. The loan
 * equivalent is LoanTerms; both exist so that raising a price records a change
 * rather than rewriting what last year cost.
 */
export interface CostTerms {
  from: Month;
  amount: number;
  payerId?: string;
}

export interface RecurringCost {
  id: string;
  category: string;
  description: string;
  /** In force before the first terms entry, and for costs that have none. */
  amount: number;
  /** Ignored when `intervalWeeks` is set. */
  intervalMonths: number;
  /**
   * Billing cadences like "every 8 weeks" do not land on a whole number of months,
   * so they need their own unit and a real date to count from. When set, this wins
   * over `intervalMonths` and `firstChargeDate` is used instead of `firstCharge`.
   */
  intervalWeeks?: number;
  /** Anchor for month-based costs. */
  firstCharge: Month;
  /** Anchor for week-based costs, as YYYY-MM-DD. */
  firstChargeDate?: string;
  /** When set, this member pays directly and the cost never touches the joint account. */
  payerId?: string;
  /**
   * On and off stretches. Absent means it has always been live, which is what
   * every cost created before pausing existed looks like. Pausing closes the open
   * period; resuming opens a new one, so a gap stays a gap in past months.
   */
  periods?: ActivePeriod[];
  terms?: CostTerms[];
}

/**
 * A one-off cost. The full amount leaves the joint account at `start` and is
 * repaid at monthlyShare() until `end` (exclusive).
 */
export interface OneOffCost {
  id: string;
  description: string;
  total: number;
  start: Month;
  end: Month;
  payerId?: string;
}

export type RateFixation = 'floating3m' | '1y' | '2y' | '3y' | '5y' | '10y';

export const RATE_FIXATIONS: RateFixation[] = ['floating3m', '1y', '2y', '3y', '5y', '10y'];

/**
 * What a loan costs and who pays it, from a given month onwards. Editing a loan
 * corrects what it is and applies to every month; adding terms records that
 * something changed on a date, so earlier months keep what they had.
 */
export interface LoanTerms {
  from: Month;
  /** Nominal annual rate as a fraction, e.g. 0.026 for 2.6%. */
  nominalRate: number;
  payerId?: string;
}

export interface Loan {
  id: string;
  description: string;
  originalDebt: number;
  /** In force before the first terms entry, and for loans that have none. */
  nominalRate: number;
  fixation: RateFixation;
  /** Date the fixed term is renegotiated (villkorsändringsdag). */
  resetDate?: Month;
  payerId?: string;
  /** Newest last is not assumed; lookups sort. */
  terms?: LoanTerms[];
}

/**
 * A stream of amortization. `parallel` splits the amount evenly across the loans
 * (the three parts of the house loan). `priority` pays them off one at a time and
 * rolls the whole amount to the next once one is cleared (the 5 000 that goes to
 * Framsida and then to the car loan).
 */
export interface AmortizationStream {
  id: string;
  name: string;
  amount: number;
  start: Month;
  mode: 'parallel' | 'priority';
  loanIds: string[];
}

export interface AccountBalance {
  month: Month;
  amount: number;
}

export interface Budget {
  household: Household;
  members: Member[];
  recurringCosts: RecurringCost[];
  oneOffCosts: OneOffCost[];
  loans: Loan[];
  amortizationStreams: AmortizationStream[];
  income: IncomeEntry[];
  /** Actual balance of the joint account, the starting point for the forecast. */
  accountBalance: AccountBalance | null;
}

/** Active members share the surplus. Invited members who have not signed in do not. */
export function activeMembers(budget: Budget): Member[] {
  return budget.members.filter((m) => m.status === 'active');
}

/**
 * The categories to offer. Whatever the household has chosen, plus any category its
 * costs already reference: a name in use must never drop out of the list, or editing
 * that cost would silently move it somewhere else.
 *
 * There is no seeded list. A new household starts with nothing and names its first
 * category when it books its first cost, so the categories are always ones someone
 * actually chose rather than a guess in one particular language.
 */
export function categoriesFor(budget: Budget): string[] {
  const chosen = budget.household.categories ?? [];
  const inUse = budget.recurringCosts.map((c) => c.category);
  const seen = new Set<string>();
  const all: string[] = [];
  for (const name of [...chosen, ...inUse]) {
    const key = name.trim().toLowerCase();
    if (!name.trim() || seen.has(key)) continue;
    seen.add(key);
    all.push(name.trim());
  }
  return all.sort((a, b) => a.localeCompare(b, 'sv'));
}

/** Week-based cadences, for billing that does not align to months. */
export const WEEK_INTERVALS = [1, 2, 4, 6, 8, 12];

export const INTERVALS = [1, 2, 3, 6, 12, 24, 36];
