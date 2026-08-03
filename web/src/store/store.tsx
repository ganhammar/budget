import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Budget, Member } from '../domain/types';
import { api, ApiError, setCurrentEmail } from '../api/client';
import { planSync } from './sync';

export function newId(): string {
  return crypto.randomUUID();
}

/** Fills in collections the API may omit, so the rest of the app can assume arrays. */
function normalize(budget: Budget): Budget {
  return {
    ...budget,
    members: budget.members ?? [],
    recurringCosts: budget.recurringCosts ?? [],
    oneOffCosts: budget.oneOffCosts ?? [],
    loans: budget.loans ?? [],
    amortizationStreams: budget.amortizationStreams ?? [],
    income: budget.income ?? [],
    dismissedPrompts: budget.dismissedPrompts ?? [],
    accountBalance: budget.accountBalance ?? null,
  };
}

interface Store {
  budget: Budget | null;
  me: Member | null;
  isAdmin: boolean;
  loading: boolean;
  error: string | null;
  update: (fn: (budget: Budget) => Budget) => void;
  createHousehold: (householdName: string, name: string, email: string) => Promise<void>;
  signInAs: (memberId: string) => void;
  reset: () => void;
}

const Ctx = createContext<Store | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const [budget, setBudget] = useState<Budget | null>(null);
  const [memberId, setMemberId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Writes are queued so two quick edits cannot race into the wrong order.
  const queue = useRef<Promise<unknown>>(Promise.resolve());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const me = await api.me();
      if (!me.authenticated || !me.profile) {
        setBudget(null);
        setMemberId(null);
        return;
      }
      setCurrentEmail(me.email);
      setMemberId(me.profile.memberId);
      setBudget(normalize(await api.budget()));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setBudget(null);
      else setError(e instanceof Error ? e.message : 'Kunde inte hämta budgeten.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = useCallback((fn: (budget: Budget) => Budget) => {
    setBudget((previous) => {
      if (!previous) return previous;
      const next = fn(previous);

      // Optimistic: the UI moves immediately and the writes follow behind it.
      const calls = planSync(previous, next);
      if (calls.length > 0) {
        queue.current = queue.current
          .then(() => Promise.all(calls))
          .catch((e: unknown) => {
            setError(e instanceof Error ? e.message : 'Ändringen kunde inte sparas.');
          });
      }
      return next;
    });
  }, []);

  const createHousehold = useCallback(
    async (householdName: string, name: string, email: string) => {
      setLoading(true);
      setError(null);
      try {
        setCurrentEmail(email);
        const created = normalize(await api.createHousehold(householdName, name, email));
        setBudget(created);
        setMemberId(created.members[0]?.id ?? null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Hushållet kunde inte skapas.');
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  /** Development affordance: switches which member the mock auth reports as caller. */
  const signInAs = useCallback(
    (id: string) => {
      const member = budget?.members.find((m) => m.id === id);
      if (!member) return;
      setCurrentEmail(member.email);
      setMemberId(id);
    },
    [budget],
  );

  /** Signs out of this browser. It does not delete anything server side. */
  const reset = useCallback(() => {
    setCurrentEmail(null);
    setBudget(null);
    setMemberId(null);
    void load();
  }, [load]);

  const value = useMemo<Store>(() => {
    const me = budget
      ? budget.members.find((m) => m.id === memberId) ?? budget.members[0] ?? null
      : null;
    return {
      budget,
      me,
      isAdmin: me?.role === 'admin',
      loading,
      error,
      update,
      createHousehold,
      signInAs,
      reset,
    };
  }, [budget, memberId, loading, error, update, createHousehold, signInAs, reset]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error('StoreProvider is missing');
  return store;
}

/** For views that only render once a household exists. */
export function useBudget(): {
  budget: Budget;
  me: Member;
  isAdmin: boolean;
  update: Store['update'];
} {
  const store = useStore();
  if (!store.budget || !store.me) throw new Error('No household');
  return { budget: store.budget, me: store.me, isAdmin: store.isAdmin, update: store.update };
}
