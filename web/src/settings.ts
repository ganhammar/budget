import { useEffect } from 'react';
import type { Language, ThemeChoice } from './domain/types';

/**
 * Both settings live on the member record so they follow you to a new device,
 * and because the reminder mails need the language server-side. These mirrors
 * exist only so the choice can be applied before the budget has loaded: the
 * theme has to be right before first paint, and the UI should not flash Swedish
 * at someone who picked English.
 */
const THEME_KEY = 'budget.theme';
const LANGUAGE_KEY = 'budget.language';
const SOLO_KEY = 'budget.solo';

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private mode or blocked storage. The server copy still applies after load.
  }
}

export function storedTheme(): ThemeChoice {
  const value = read(THEME_KEY);
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function storedLanguage(): Language | null {
  const value = read(LANGUAGE_KEY);
  return value === 'sv' || value === 'en' ? value : null;
}

/** Swedish unless the browser clearly asks for English. */
export function defaultLanguage(): Language {
  return navigator.language?.toLowerCase().startsWith('en') ? 'en' : 'sv';
}

function resolve(choice: ThemeChoice): 'light' | 'dark' {
  if (choice !== 'system') return choice;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/**
 * Applies the theme and keeps following the OS while the choice is "system",
 * so switching appearance at night changes the app without a reload.
 */
export function useTheme(choice: ThemeChoice): void {
  useEffect(() => {
    write(THEME_KEY, choice);
    document.documentElement.dataset.theme = resolve(choice);

    if (choice !== 'system') return;
    const query = matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      document.documentElement.dataset.theme = resolve('system');
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [choice]);
}

export function rememberLanguage(language: Language): void {
  write(LANGUAGE_KEY, language);
}

/**
 * Whether the household has said it is one person.
 *
 * Kept locally rather than on the record: it answers a question the app asked,
 * not a fact about the household, and inviting someone later settles it properly
 * by making the question moot. Per device, so at worst it is asked once more
 * somewhere else and dismissed again.
 */
export function livesAlone(): boolean {
  return read(SOLO_KEY) === 'true';
}

export function rememberLivesAlone(): void {
  write(SOLO_KEY, 'true');
}
