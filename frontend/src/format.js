// Amounts arrive from the backend as decimal strings, e.g. "-42.30"
export function formatAmount(amount, currency, locale) {
  return new Intl.NumberFormat(locale, { style: "currency", currency, signDisplay: "always" }).format(Number(amount));
}

// Dates are ISO strings without a time (e.g. "2026-11-12"): parsing them as UTC could show the previous day
export function formatDate(date, locale) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

export function today() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}
