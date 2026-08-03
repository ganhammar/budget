import type { Budget } from '../domain/types';

/** Same origin in production, proxied by Vite in development. */
const BASE = '/api';

/** Mock auth: the signed-in identity travels in a header until Google sign-in lands. */
const USER_KEY = 'budget.user';

export function currentEmail(): string | null {
  return localStorage.getItem(USER_KEY);
}

export function setCurrentEmail(email: string | null): void {
  if (email) localStorage.setItem(USER_KEY, email);
  else localStorage.removeItem(USER_KEY);
}

export interface Profile {
  email: string;
  householdId: string;
  memberId: string;
}

export interface Me {
  authenticated: boolean;
  email: string;
  profile: Profile | null;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const email = currentEmail();
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(email ? { 'X-Budget-User': email } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let message = `${response.status}`;
    try {
      const body = await response.json();
      if (body && typeof body.message === 'string') message = body.message;
    } catch {
      // Non-JSON error body; the status alone is the useful part.
    }
    throw new ApiError(response.status, message);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  me: () => request<Me>('/me'),
  budget: () => request<Budget>('/budget'),

  createHousehold: (householdName: string, name: string, email: string) =>
    request<Budget>('/households', {
      method: 'POST',
      body: JSON.stringify({ householdName, name, email }),
    }),

  renameHousehold: (name: string) =>
    request<void>('/household', { method: 'PUT', body: JSON.stringify({ name }) }),

  setAccountBalance: (month: string, amount: number) =>
    request<void>('/account-balance', { method: 'PUT', body: JSON.stringify({ month, amount }) }),

  put: <T>(collection: string, id: string, body: T) =>
    request<void>(`/${collection}/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),

  remove: (collection: string, id: string) =>
    request<void>(`/${collection}/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  putIncome: (month: string, memberId: string, amount: number, enteredById?: string) =>
    request<void>(`/income/${month}/${encodeURIComponent(memberId)}`, {
      method: 'PUT',
      body: JSON.stringify({ amount, enteredById: enteredById ?? null }),
    }),

  deleteIncome: (month: string, memberId: string) =>
    request<void>(`/income/${month}/${encodeURIComponent(memberId)}`, { method: 'DELETE' }),

  putDismissal: (month: string, memberId: string) =>
    request<void>(`/dismissals/${month}/${encodeURIComponent(memberId)}`, { method: 'PUT' }),

  deleteDismissal: (month: string, memberId: string) =>
    request<void>(`/dismissals/${month}/${encodeURIComponent(memberId)}`, { method: 'DELETE' }),
};
