const currency = new Intl.NumberFormat('sv-SE', {
  style: 'currency',
  currency: 'SEK',
  maximumFractionDigits: 0,
});

/** Formats an amount as SEK, e.g. "21 500 kr". */
export function sek(amount: number): string {
  return currency.format(amount);
}

/** 0.026 -> "2,60 %" */
export function percent(fraction: number, decimals = 2): string {
  return `${(fraction * 100).toLocaleString('sv-SE', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })} %`;
}
