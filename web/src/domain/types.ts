/** A month, formatted "2026-08". */
export type Month = string;

export type Role = 'admin' | 'member';

/** The household is the tenant. All budget data belongs to exactly one household. */
export interface Household {
  id: string;
  name: string;
  created: Month;
}

/**
 * A member of the household. `invited` means the email is registered but the
 * person has not signed in yet, so they are excluded from the split.
 */
export interface Member {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: 'active' | 'invited';
  /** Baseline monthly income, used for future months and as a fallback. */
  baselineIncome: number;
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
export interface RecurringCost {
  id: string;
  category: string;
  description: string;
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

export const RATE_FIXATIONS: { value: RateFixation; label: string }[] = [
  { value: 'floating3m', label: '3 mån (rörlig)' },
  { value: '1y', label: '1 år' },
  { value: '2y', label: '2 år' },
  { value: '3y', label: '3 år' },
  { value: '5y', label: '5 år' },
  { value: '10y', label: '10 år' },
];

export interface Loan {
  id: string;
  description: string;
  originalDebt: number;
  /** Nominal annual rate as a fraction, e.g. 0.026 for 2.6%. */
  nominalRate: number;
  fixation: RateFixation;
  /** Date the fixed term is renegotiated (villkorsändringsdag). */
  resetDate?: Month;
  payerId?: string;
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

/** User-facing category labels, so these stay Swedish. */
export const CATEGORIES = ['Hus', 'Barn', 'Mat', 'Media', 'Husdjur', 'Bil', 'Övrigt'];

/** Week-based cadences, for billing that does not align to months. */
export const WEEK_INTERVALS: { value: number; label: string }[] = [
  { value: 1, label: 'Varje vecka' },
  { value: 2, label: 'Varannan vecka' },
  { value: 4, label: 'Var 4:e vecka' },
  { value: 6, label: 'Var 6:e vecka' },
  { value: 8, label: 'Var 8:e vecka' },
  { value: 12, label: 'Var 12:e vecka' },
];

export const INTERVALS: { value: number; label: string }[] = [
  { value: 1, label: 'Varje månad' },
  { value: 2, label: 'Varannan månad' },
  { value: 3, label: 'Kvartalsvis' },
  { value: 6, label: 'Halvårsvis' },
  { value: 12, label: 'Årsvis' },
  { value: 24, label: 'Vartannat år' },
  { value: 36, label: 'Vart tredje år' },
];
