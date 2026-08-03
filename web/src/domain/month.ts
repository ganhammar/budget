import type { Month } from './types';

const MONTH_NAMES = [
  'januari', 'februari', 'mars', 'april', 'maj', 'juni',
  'juli', 'augusti', 'september', 'oktober', 'november', 'december',
];

const SHORT_NAMES = [
  'jan', 'feb', 'mar', 'apr', 'maj', 'jun',
  'jul', 'aug', 'sep', 'okt', 'nov', 'dec',
];

/** Months since year zero, which makes comparison and arithmetic trivial. */
export function toIndex(m: Month): number {
  const [year, month] = m.split('-').map(Number);
  return year * 12 + (month - 1);
}

export function fromIndex(i: number): Month {
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`;
}

export function addMonths(m: Month, count: number): Month {
  return fromIndex(toIndex(m) + count);
}

/** Months from a to b. monthsBetween("2026-09", "2027-08") === 11. */
export function monthsBetween(a: Month, b: Month): number {
  return toIndex(b) - toIndex(a);
}

export function currentMonth(): Month {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

export function currentDayOfMonth(): number {
  return new Date().getDate();
}

export function formatMonth(m: Month): string {
  const [year, month] = m.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

export function formatMonthShort(m: Month): string {
  const [year, month] = m.split('-');
  return `${SHORT_NAMES[Number(month) - 1]} ${year.slice(2)}`;
}

/** Inclusive list of months from `from` to `to`. */
export function monthRange(from: Month, to: Month): Month[] {
  const out: Month[] = [];
  for (let i = toIndex(from); i <= toIndex(to); i++) out.push(fromIndex(i));
  return out;
}
