import type { Budget } from '../domain/types';
import { api } from '../api/client';

/**
 * Derives the API calls needed to turn `previous` into `next`.
 *
 * Components mutate the whole budget object, which reads well but does not map
 * onto per-entity endpoints. Diffing keeps that ergonomics without threading a
 * save call through every component. The budget is a few dozen entities, so
 * comparing them all costs nothing.
 */
export function planSync(previous: Budget, next: Budget): Promise<unknown>[] {
  const calls: Promise<unknown>[] = [];

  collection(calls, 'members', previous.members, next.members, (m) => m.id);
  collection(calls, 'costs', previous.recurringCosts, next.recurringCosts, (c) => c.id);
  collection(calls, 'oneoffs', previous.oneOffCosts, next.oneOffCosts, (c) => c.id);
  collection(calls, 'loans', previous.loans, next.loans, (l) => l.id);
  collection(
    calls,
    'streams',
    previous.amortizationStreams,
    next.amortizationStreams,
    (s) => s.id,
  );

  // Income and dismissals are keyed by month plus member rather than an id.
  const incomeKey = (e: { month: string; memberId: string }) => `${e.month}|${e.memberId}`;
  diff(
    previous.income,
    next.income,
    incomeKey,
    (entry) => calls.push(api.putIncome(entry.month, entry.memberId, entry.amount, entry.enteredById ?? undefined)),
    (entry) => calls.push(api.deleteIncome(entry.month, entry.memberId)),
  );

  if (previous.household.name !== next.household.name) {
    calls.push(api.renameHousehold(next.household.name));
  }

  const beforeCategories = previous.household.categories;
  const afterCategories = next.household.categories;
  if (afterCategories && JSON.stringify(beforeCategories) !== JSON.stringify(afterCategories)) {
    calls.push(api.setCategories(afterCategories));
  }

  const before = previous.accountBalance;
  const after = next.accountBalance;
  if (after && (!before || before.month !== after.month || before.amount !== after.amount)) {
    calls.push(api.setAccountBalance(after.month, after.amount));
  }

  return calls;
}

function collection<T>(
  calls: Promise<unknown>[],
  name: string,
  previous: T[],
  next: T[],
  key: (item: T) => string,
): void {
  diff(
    previous,
    next,
    key,
    (item) => calls.push(api.put(name, key(item), item)),
    (item) => calls.push(api.remove(name, key(item))),
  );
}

function diff<T>(
  previous: T[],
  next: T[],
  key: (item: T) => string,
  upsert: (item: T) => void,
  remove: (item: T) => void,
): void {
  const before = new Map(previous.map((item) => [key(item), item]));
  const after = new Map(next.map((item) => [key(item), item]));

  for (const [id, item] of after) {
    const existing = before.get(id);
    if (!existing || JSON.stringify(existing) !== JSON.stringify(item)) upsert(item);
  }
  for (const [id, item] of before) {
    if (!after.has(id)) remove(item);
  }
}
