import type { Budget } from '../domain/types';

/** Same origin in production, proxied by Vite in development. */
const BASE = '/api';

export interface Profile {
  email: string;
  householdId: string;
  memberId: string;
}

export interface Me {
  signedIn: boolean;
  email: string | null;
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
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    // Carries the session cookie. Same-origin in production, but the dev proxy
    // needs it stated explicitly.
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...init?.headers },
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

  /** Exchanges a Google ID token for our own session cookie. */
  signIn: (credential: string) =>
    request<Me>('/auth/session', { method: 'POST', body: JSON.stringify({ credential }) }),

  signOut: () => request<void>('/auth/signout', { method: 'POST' }),

  createHousehold: (householdName: string, name: string) =>
    request<Budget>('/households', {
      method: 'POST',
      body: JSON.stringify({ householdName, name }),
    }),

  setCategories: (categories: string[]) =>
    request<void>('/household/categories', {
      method: 'PUT',
      body: JSON.stringify({ categories }),
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

  /** Re-sends the invite mail. An action rather than a state change, so it bypasses the sync diff. */
  resendInvite: (memberId: string) =>
    request<void>(`/members/${encodeURIComponent(memberId)}/invite`, { method: 'POST' }),

  putIncome: (month: string, memberId: string, amount: number, enteredById?: string) =>
    request<void>(`/income/${month}/${encodeURIComponent(memberId)}`, {
      method: 'PUT',
      body: JSON.stringify({ amount, enteredById: enteredById ?? null }),
    }),

  deleteIncome: (month: string, memberId: string) =>
    request<void>(`/income/${month}/${encodeURIComponent(memberId)}`, { method: 'DELETE' }),

};
