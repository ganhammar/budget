import type {
  ActivePeriod,
  AmortizationStream,
  Budget,
  Loan,
  Month,
  OneOffCost,
  RecurringCost,
  Saving,
} from './types';
import type { Text } from '../i18n';
import { activeMembers } from './types';
import {
  addDays,
  addMonths,
  DAYS_PER_YEAR,
  fromIndex,
  monthOf,
  monthRange,
  monthsBetween,
  toIndex,
} from './month';

/* ---------- Recurring costs ---------- */

/**
 * Whether a recurring cost is live in a month. Absent periods mean always live.
 *
 * Pausing is expressed as a closed period rather than a flag, because a flag would
 * remove the cost from every month including the ones it was actually paid in, and
 * the whole point is that past months keep their figures.
 */
export function isCostLiveIn(item: { periods?: ActivePeriod[] }, month: Month): boolean {
  if (!item.periods || item.periods.length === 0) return true;
  return item.periods.some(
    (p) =>
      (!p.from || monthsBetween(p.from, month) >= 0) &&
      (!p.to || monthsBetween(month, p.to) > 0),
  );
}

/** Live right now, which is what the list hides when you pause something. */
export function isCostPaused(item: { periods?: ActivePeriod[] }, month: Month): boolean {
  return !isCostLiveIn(item, month);
}

/** The month a paused item stopped counting, for showing on the row. */
export function pausedFrom(item: { periods?: ActivePeriod[] }): Month | null {
  const closed = (item.periods ?? []).filter((p) => p.to);
  if (closed.length === 0) return null;
  return closed.map((p) => p.to!).sort().at(-1) ?? null;
}

/**
 * The amount and payer in force for a month: the latest terms starting at or
 * before it, else the cost's own fields.
 */
export function costTermsAt(cost: RecurringCost, month: Month): { amount: number; payerId?: string } {
  const applicable = (cost.terms ?? [])
    .filter((entry) => entry.from <= month)
    .sort((a, b) => a.from.localeCompare(b.from));
  const current = applicable[applicable.length - 1];
  return current ?? { amount: cost.amount, payerId: cost.payerId };
}

/** Smoothed monthly cost. This is what drives the split between members. */
export function monthlyAmount(cost: RecurringCost, month: Month): number {
  const { amount } = costTermsAt(cost, month);
  if (cost.intervalWeeks && cost.intervalWeeks > 0) {
    // Charges per year, spread over twelve. Eight weeks is 6.52 charges, not six.
    const perYear = DAYS_PER_YEAR / (7 * cost.intervalWeeks);
    return (amount * perYear) / 12;
  }
  return amount / Math.max(1, cost.intervalMonths);
}

/**
 * How many times the cost is charged in a month.
 *
 * A count rather than a yes/no, because a cadence shorter than a month can land
 * twice in one: every four weeks does so roughly once a year, and the account
 * forecast would be short by a whole charge if that month only counted once.
 */
export function chargesIn(cost: RecurringCost, month: Month): number {
  if (cost.intervalWeeks && cost.intervalWeeks > 0) {
    const start = cost.firstChargeDate;
    if (!start) return 0;

    const step = 7 * cost.intervalWeeks;
    let date = start;
    // Month strings sort chronologically, so this is a plain walk forward. A
    // cadence measured in weeks has no closed form against calendar months.
    while (monthOf(date) < month) date = addDays(date, step);

    let count = 0;
    while (monthOf(date) === month) {
      count++;
      date = addDays(date, step);
    }
    return count;
  }

  const delta = monthsBetween(cost.firstCharge, month);
  return delta >= 0 && delta % Math.max(1, cost.intervalMonths) === 0 ? 1 : 0;
}

/** Whether the cost is charged at all in this month. */
export function isChargedIn(cost: RecurringCost, month: Month): boolean {
  return chargesIn(cost, month) > 0;
}

/**
  * How the cadence reads on a row, e.g. "var 8:e vecka". Takes the dictionary
  * rather than importing it, so the domain stays free of UI dependencies.
  */
export function intervalLabel(cost: RecurringCost, t: Text): string {
  if (cost.intervalWeeks && cost.intervalWeeks > 0) return t.intervalEveryNWeeks(cost.intervalWeeks);
  if (cost.intervalMonths === 1) return t.intervalMonthly;
  if (cost.intervalMonths === 12) return t.intervalYearly;
  if (cost.intervalMonths === 3) return t.intervalQuarterly;
  if (cost.intervalMonths === 6) return t.intervalHalfYearly;
  return t.intervalEveryNMonths(cost.intervalMonths);
}

/** Upcoming charge months, for display in the list. */
export function upcomingCharges(cost: RecurringCost, from: Month, count: number): Month[] {
  return monthRange(from, addMonths(from, count - 1)).filter((m) => isChargedIn(cost, m));
}

/* ---------- Savings ---------- */

/** The contribution in force for a month, else the saving's own amount. */
export function savingAmountAt(saving: Saving, month: Month): number {
  const applicable = (saving.terms ?? [])
    .filter((entry) => entry.from <= month)
    .sort((a, b) => a.from.localeCompare(b.from));
  return applicable[applicable.length - 1]?.amount ?? saving.amount;
}

/**
 * What you are putting away this month. Paused savings count for nothing now but
 * stay in the months they ran, the same as a paused cost.
 */
export function savingsTotal(budget: Budget, month: Month): number {
  return budget.savings
    .filter((s) => isCostLiveIn(s, month))
    .reduce((sum, s) => sum + savingAmountAt(s, month), 0);
}

/* ---------- One-off costs ---------- */

export function repaymentMonths(cost: OneOffCost): number {
  return Math.max(1, monthsBetween(cost.start, cost.end));
}

export function monthlyShare(cost: OneOffCost): number {
  return cost.total / repaymentMonths(cost);
}

/** Active from the start month up to and including the month before `end`. */
export function isActiveIn(cost: OneOffCost, month: Month): boolean {
  const delta = monthsBetween(cost.start, month);
  return delta >= 0 && delta < repaymentMonths(cost);
}

export function monthsRemaining(cost: OneOffCost, month: Month): number {
  return Math.max(0, Math.min(repaymentMonths(cost), monthsBetween(month, cost.end)));
}

export function remainingToRepay(cost: OneOffCost, month: Month): number {
  return monthsRemaining(cost, month) * monthlyShare(cost);
}

/* ---------- Loans ---------- */

/**
 * Effective annual rate from the nominal rate, with monthly compounding.
 * 2.6% nominal gives 2.6312% effective. Without fees that is the whole difference;
 * Swedish "effektiv ränta" also folds in fees, which this model does not carry.
 */
export function effectiveRate(nominal: number): number {
  return Math.pow(1 + nominal / 12, 12) - 1;
}

/**
 * The rate and payer in force for a month: the latest terms starting at or before
 * it, else the loan's own fields, which is what every loan recorded before terms
 * existed carries.
 */
export function termsAt(loan: Loan, month: Month): { nominalRate: number; payerId?: string } {
  const applicable = (loan.terms ?? [])
    .filter((t) => t.from <= month)
    .sort((a, b) => a.from.localeCompare(b.from));
  const current = applicable[applicable.length - 1];
  return current ?? { nominalRate: loan.nominalRate, payerId: loan.payerId };
}

export function monthlyInterest(loan: Loan, debt: number, month: Month): number {
  return (debt * termsAt(loan, month).nominalRate) / 12;
}

/** Below this, a debt counts as settled. */
const EPSILON = 0.005;

/**
 * What a stream pays in a month: the latest terms starting at or before it, else
 * the amount it began with. Raising an amortization therefore changes the months
 * from then on and leaves the debt curve behind it alone.
 */
export function streamAmountAt(stream: AmortizationStream, month: Month): number {
  const applicable = (stream.terms ?? [])
    .filter((entry) => entry.from <= month)
    .sort((a, b) => a.from.localeCompare(b.from));
  return applicable[applicable.length - 1]?.amount ?? stream.amount;
}

function applyAmortization(
  budget: Budget,
  debts: Map<string, number>,
  month: Month,
): Map<string, number> {
  const paid = new Map<string, number>();

  for (const stream of budget.amortizationStreams) {
    if (toIndex(month) < toIndex(stream.start)) continue;

    const open = stream.loanIds.filter((loanId) => (debts.get(loanId) ?? 0) > EPSILON);
    if (open.length === 0) continue;

    const budgeted = streamAmountAt(stream, month);
    if (stream.mode === 'parallel') {
      const share = budgeted / open.length;
      for (const loanId of open) {
        const debt = debts.get(loanId) ?? 0;
        const part = Math.min(share, debt);
        debts.set(loanId, debt - part);
        paid.set(loanId, (paid.get(loanId) ?? 0) + part);
      }
    } else {
      let left = budgeted;
      for (const loanId of stream.loanIds) {
        if (left <= EPSILON) break;
        const debt = debts.get(loanId) ?? 0;
        if (debt <= EPSILON) continue;
        const part = Math.min(left, debt);
        debts.set(loanId, debt - part);
        paid.set(loanId, (paid.get(loanId) ?? 0) + part);
        left -= part;
      }
    }
  }

  return paid;
}

/** Debt per loan at the start of the given month. */
export function debtAtStartOf(budget: Budget, month: Month): Map<string, number> {
  const debts = new Map<string, number>();
  // A loan with no start month has always been here; one with a start month does
  // not exist until it is reached, so looking further back shows nothing.
  for (const loan of budget.loans) debts.set(loan.id, loan.started ? 0 : loan.originalDebt);

  const starts = [
    ...budget.amortizationStreams.map((s) => toIndex(s.start)),
    ...budget.loans.filter((l) => l.started).map((l) => toIndex(l.started!)),
  ];
  if (starts.length === 0) return debts;

  const target = toIndex(month);
  for (let i = Math.min(...starts); i <= target; i++) {
    const at = fromIndex(i);
    for (const loan of budget.loans) {
      if (loan.started === at) debts.set(loan.id, loan.originalDebt);
    }
    if (i < target) applyAmortization(budget, debts, at);
  }
  return debts;
}

/** The month the last loan is cleared, or null if no amortization is configured. */
export function debtFreeMonth(budget: Budget): Month | null {
  if (budget.loans.length === 0 || budget.amortizationStreams.length === 0) return null;

  const debts = new Map<string, number>();
  for (const loan of budget.loans) debts.set(loan.id, loan.started ? 0 : loan.originalDebt);

  let i = Math.min(
    ...budget.amortizationStreams.map((s) => toIndex(s.start)),
    ...budget.loans.filter((l) => l.started).map((l) => toIndex(l.started!)),
  );
  const limit = i + 1200;
  while (i < limit) {
    // A loan joins the walk in the month it was taken out.
    for (const loan of budget.loans) {
      if (loan.started === fromIndex(i)) debts.set(loan.id, loan.originalDebt);
    }
    const left = [...debts.values()].reduce((sum, d) => sum + d, 0);
    if (left <= EPSILON) return fromIndex(i);
    if (applyAmortization(budget, debts, fromIndex(i)).size === 0) return null;
    i++;
  }
  return null;
}

export interface DebtPoint {
  month: Month;
  /** Remaining debt per loan id at the start of this month. */
  debts: Record<string, number>;
  total: number;
  /** Interest charged that month per loan id, at the rate in force then. */
  interest: Record<string, number>;
  interestTotal: number;
  /** The nominal rate in force that month, as a fraction. */
  rate: Record<string, number>;
}

/**
 * Debt per loan, month by month. Shows amortization streams rolling from one loan
 * onto the next as each is cleared, which is the whole point of plotting it.
 */
export function debtOverTime(budget: Budget, from: Month, months: number): DebtPoint[] {
  const debts = debtAtStartOf(budget, from);
  const out: DebtPoint[] = [];

  for (let i = 0; i < months; i++) {
    const month = addMonths(from, i);
    const snapshot: Record<string, number> = {};
    const interest: Record<string, number> = {};
    const rate: Record<string, number> = {};
    let total = 0;
    let interestTotal = 0;
    for (const loan of budget.loans) {
      const value = debts.get(loan.id) ?? 0;
      // Interest is what that debt costs at the rate in force that month, so the
      // series bends with both amortization and any recorded rate change.
      const nominal = termsAt(loan, month).nominalRate;
      const charged = (value * nominal) / 12;
      snapshot[loan.id] = value;
      interest[loan.id] = charged;
      rate[loan.id] = nominal;
      total += value;
      interestTotal += charged;
    }
    out.push({ month, debts: snapshot, total, interest, interestTotal, rate });
    applyAmortization(budget, debts, month);
  }

  return out;
}

/**
 * The month each loan reaches zero, or null where nothing amortizes it.
 *
 * A stacked chart cannot answer this on its own: a 30 000 loan beside a million
 * is a few pixels tall and appears to vanish immediately, or not to exist at all.
 */
export function payoffMonths(budget: Budget): Record<string, Month | null> {
  const result: Record<string, Month | null> = {};
  for (const loan of budget.loans) result[loan.id] = null;

  if (budget.amortizationStreams.length === 0) return result;

  const debts = new Map<string, number>();
  for (const loan of budget.loans) debts.set(loan.id, loan.originalDebt);

  let i = Math.min(...budget.amortizationStreams.map((s) => toIndex(s.start)));
  const limit = i + 1200;

  while (i < limit) {
    const month = fromIndex(i);
    if (applyAmortization(budget, debts, month).size === 0) {
      // Nothing left that any stream can pay down.
      if ([...debts.values()].every((d) => d <= EPSILON)) break;
      break;
    }
    for (const loan of budget.loans) {
      if (result[loan.id] === null && (debts.get(loan.id) ?? 0) <= EPSILON) {
        result[loan.id] = addMonths(month, 1);
      }
    }
    if ([...debts.values()].every((d) => d <= EPSILON)) break;
    i++;
  }

  return result;
}

/* ---------- Income ---------- */

export function incomeFor(budget: Budget, memberId: string, month: Month): number {
  const actual = budget.income.find((i) => i.memberId === memberId && i.month === month);
  if (actual) return actual.amount;
  return budget.members.find((m) => m.id === memberId)?.baselineIncome ?? 0;
}

export function hasActualIncome(budget: Budget, memberId: string, month: Month): boolean {
  return budget.income.some((i) => i.memberId === memberId && i.month === month);
}

/* ---------- Monthly calculation ---------- */

export interface LoanLine {
  loan: Loan;
  debt: number;
  interest: number;
  amortization: number;
  total: number;
  /** Payer in force for the month, which may differ from the loan's current one. */
  payerId?: string;
}

export interface MemberLine {
  memberId: string;
  name: string;
  income: number;
  /** Smoothed costs this member pays directly, deducted from their transfer. */
  paidDirectly: number;
  toTransfer: number;
  leftOver: number;
}

export interface MonthResult {
  month: Month;
  totalIncome: number;
  recurringTotal: number;
  oneOffTotal: number;
  loanTotal: number;
  totalCosts: number;
  surplus: number;
  surplusPerMember: number;
  loanLines: LoanLine[];
  memberLines: MemberLine[];
  /** Actual withdrawals from the joint account this month, lumpy rather than smoothed. */
  jointOutflow: number;
  outflowItems: { label: string; amount: number }[];
  jointInflow: number;
}

function calculate(budget: Budget, month: Month, debts: Map<string, number>): MonthResult {
  const loanLines: LoanLine[] = budget.loans.map((loan) => {
    const debt = debts.get(loan.id) ?? 0;
    const interest = monthlyInterest(loan, debt, month);
    // The payer is resolved per month too, so a loan that changed hands is charged
    // to whoever was carrying it at the time.
    return { loan, debt, interest, amortization: 0, total: interest, payerId: termsAt(loan, month).payerId };
  });

  // Amortization for this month is computed on a copy so the caller's debts stay put.
  const paid = applyAmortization(budget, new Map(debts), month);
  for (const line of loanLines) {
    line.amortization = paid.get(line.loan.id) ?? 0;
    line.total = line.interest + line.amortization;
  }

  const liveCosts = budget.recurringCosts.filter((c) => isCostLiveIn(c, month));
  const recurringTotal = liveCosts.reduce((sum, c) => sum + monthlyAmount(c, month), 0);
  const activeOneOffs = budget.oneOffCosts.filter((c) => isActiveIn(c, month));
  const oneOffTotal = activeOneOffs.reduce((sum, c) => sum + monthlyShare(c), 0);
  const loanTotal = loanLines.reduce((sum, l) => sum + l.total, 0);
  const totalCosts = recurringTotal + oneOffTotal + loanTotal;

  const members = activeMembers(budget);
  const totalIncome = members.reduce((sum, m) => sum + incomeFor(budget, m.id, month), 0);
  const surplus = totalIncome - totalCosts;
  const surplusPerMember = members.length > 0 ? surplus / members.length : 0;

  const memberLines: MemberLine[] = members.map((member) => {
    const income = incomeFor(budget, member.id, month);
    const paidDirectly =
      liveCosts
        .filter((c) => costTermsAt(c, month).payerId === member.id)
        .reduce((sum, c) => sum + monthlyAmount(c, month), 0) +
      activeOneOffs.filter((c) => c.payerId === member.id).reduce((s, c) => s + monthlyShare(c), 0) +
      loanLines.filter((l) => l.payerId === member.id).reduce((s, l) => s + l.total, 0);
    const toTransfer = income - paidDirectly - surplusPerMember;
    return {
      memberId: member.id,
      name: member.name,
      income,
      paidDirectly,
      toTransfer,
      leftOver: income - paidDirectly - toTransfer,
    };
  });

  // Actual cash flow on the joint account: lumpy, not smoothed.
  const outflowItems: { label: string; amount: number; oneOff?: boolean }[] = [];
  for (const cost of liveCosts) {
    const terms = costTermsAt(cost, month);
    if (terms.payerId) continue;
    const times = chargesIn(cost, month);
    if (times === 0) continue;
    outflowItems.push({
      label: times > 1 ? `${cost.description} (${times}×)` : cost.description,
      amount: terms.amount * times,
    });
  }
  for (const cost of budget.oneOffCosts) {
    if (cost.payerId || cost.start !== month) continue;
    outflowItems.push({ label: cost.description, amount: cost.total, oneOff: true });
  }
  for (const line of loanLines) {
    if (line.payerId || line.total <= 0) continue;
    outflowItems.push({ label: line.loan.description, amount: line.total });
  }

  return {
    month,
    totalIncome,
    recurringTotal,
    oneOffTotal,
    loanTotal,
    totalCosts,
    surplus,
    surplusPerMember,
    loanLines,
    memberLines,
    jointOutflow: outflowItems.reduce((sum, i) => sum + i.amount, 0),
    outflowItems,
    jointInflow: memberLines.reduce((sum, l) => sum + l.toTransfer, 0),
  };
}

export function calculateRange(budget: Budget, from: Month, to: Month): MonthResult[] {
  const debts = debtAtStartOf(budget, from);
  const out: MonthResult[] = [];
  for (const month of monthRange(from, to)) {
    out.push(calculate(budget, month, debts));
    applyAmortization(budget, debts, month);
  }
  return out;
}

export function calculateMonth(budget: Budget, month: Month): MonthResult {
  return calculateRange(budget, month, month)[0];
}

/* ---------- Joint account forecast ---------- */

export interface ForecastPoint {
  month: Month;
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
  items: { label: string; amount: number; oneOff?: boolean }[];
}

export function forecast(budget: Budget, months: number): ForecastPoint[] {
  if (!budget.accountBalance) return [];

  const from = budget.accountBalance.month;
  const results = calculateRange(budget, from, addMonths(from, months - 1));

  let balance = budget.accountBalance.amount;
  return results.map((result) => {
    const opening = balance;
    const closing = opening + result.jointInflow - result.jointOutflow;
    balance = closing;
    return {
      month: result.month,
      opening,
      inflow: result.jointInflow,
      outflow: result.jointOutflow,
      closing,
      // Only the lumpy items are worth surfacing in the chart tooltip.
      items: result.outflowItems
        .filter((i) => i.amount >= 1000)
        .sort((a, b) => b.amount - a.amount),
    };
  });
}
