import type { Language } from './types';

/**
 * The locale is module state rather than a parameter because `sek` is called from
 * nearly every render path; threading it through would touch far more code than it
 * would clarify. It is set once, above the tree, before anything formats.
 */
const LOCALES: Record<Language, string> = { sv: 'sv-SE', en: 'en-GB' };

let locale = LOCALES.sv;
let currency = build(locale);

function build(tag: string): Intl.NumberFormat {
  return new Intl.NumberFormat(tag, {
    style: 'currency',
    currency: 'SEK',
    maximumFractionDigits: 0,
  });
}

export function setLocale(language: Language): void {
  const tag = LOCALES[language];
  if (tag === locale) return;
  locale = tag;
  currency = build(tag);
}

/** Formats an amount in SEK: "21 500 kr" in Swedish, "SEK 21,500" in English. */
export function sek(amount: number): string {
  return currency.format(amount);
}

/** 0.026 -> "2,60 %" */
export function percent(fraction: number, decimals = 2): string {
  return `${(fraction * 100).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} %`;
}
