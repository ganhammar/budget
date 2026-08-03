import type { Budget, Member, Month } from './types';
import { activeMembers } from './types';
import { addMonths, fromIndex, monthRange, toIndex } from './month';

/**
 * Day of the month from which the banner starts asking. Salaries typically land
 * on the 25th and are known around the 15th, so the second week is early enough
 * to be useful without asking before anyone could answer.
 */
export const INCOME_PROMPT_DAY = 8;

/** How many months of history to show even when nothing has been recorded yet. */
const MIN_HISTORY_MONTHS = 6;

export function hasConfirmedIncome(budget: Budget, memberId: string, month: Month): boolean {
  return budget.income.some((i) => i.memberId === memberId && i.month === month);
}

export function isPromptDismissed(budget: Budget, memberId: string, month: Month): boolean {
  return budget.dismissedPrompts.some((d) => d.memberId === memberId && d.month === month);
}

/**
 * The banner is per viewer: it asks you about your own income only, and stays
 * closed once you have answered or dismissed it for that month.
 */
export function shouldPromptForIncome(
  budget: Budget,
  memberId: string,
  month: Month,
  dayOfMonth: number,
): boolean {
  if (dayOfMonth < INCOME_PROMPT_DAY) return false;
  if (!activeMembers(budget).some((m) => m.id === memberId)) return false;
  if (hasConfirmedIncome(budget, memberId, month)) return false;
  return !isPromptDismissed(budget, memberId, month);
}

/** Active members who have not confirmed a figure for the month yet. */
export function membersAwaitingIncome(budget: Budget, month: Month): Member[] {
  return activeMembers(budget).filter((m) => !hasConfirmedIncome(budget, m.id, month));
}

/** You may always edit your own income. Admins may edit anyone's. */
export function canEditIncomeFor(me: Member, memberId: string): boolean {
  return me.id === memberId || me.role === 'admin';
}

export interface HistoryEntry {
  memberId: string;
  name: string;
  amount: number;
  confirmed: boolean;
}

export interface HistoryRow {
  month: Month;
  entries: HistoryEntry[];
  total: number;
  fullyConfirmed: boolean;
}

/** Newest first, back to the earliest recorded figure. */
export function incomeHistory(budget: Budget, upTo: Month): HistoryRow[] {
  const members = activeMembers(budget);
  const recorded = budget.income.map((i) => toIndex(i.month));
  const earliest = recorded.length > 0 ? Math.min(...recorded) : toIndex(upTo);
  const from = fromIndex(
    Math.min(earliest, toIndex(addMonths(upTo, -(MIN_HISTORY_MONTHS - 1)))),
  );

  return monthRange(from, upTo)
    .reverse()
    .map((month) => {
      const entries = members.map((member) => {
        const entry = budget.income.find((i) => i.memberId === member.id && i.month === month);
        return {
          memberId: member.id,
          name: member.name,
          amount: entry ? entry.amount : member.baselineIncome,
          confirmed: entry !== undefined,
        };
      });
      return {
        month,
        entries,
        total: entries.reduce((sum, e) => sum + e.amount, 0),
        fullyConfirmed: entries.length > 0 && entries.every((e) => e.confirmed),
      };
    });
}
