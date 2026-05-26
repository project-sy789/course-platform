/**
 * Display helpers — Thai locale, THB currency.
 * Backend stores prices in satang (1 THB = 100 satang) in `price_cents`/`amount_cents`.
 * That column name is a holdover from the original USD design; semantics are now satang.
 */

const THB = new Intl.NumberFormat("th-TH", {
  style: "currency",
  currency: "THB",
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

export function formatTHB(satang: number): string {
  return THB.format(satang / 100);
}

const DATE = new Intl.DateTimeFormat("th-TH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  calendar: "buddhist",
});

export function formatThaiDate(iso: string | Date): string {
  return DATE.format(typeof iso === "string" ? new Date(iso) : iso);
}

// Buddhist Era datetime — "27 พ.ค. 2569 14:08" style.
// Intl with calendar: 'buddhist' renders the BE year + Thai month names;
// on browsers where the default differs (rare) this guarantees BE.
const DATETIME = new Intl.DateTimeFormat("th-TH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  calendar: "buddhist",
});

export function formatThaiDateTime(iso: string | Date): string {
  return DATETIME.format(typeof iso === "string" ? new Date(iso) : iso);
}

// Thai-numerals integer formatter for counters/stats. Keeps the language
// consistent across the admin dashboard.
const NUM = new Intl.NumberFormat("th-TH");
export function formatNumber(n: number): string {
  return NUM.format(n);
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
