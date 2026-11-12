// Amounts arrive from the backend as decimal strings, e.g. "-42.30"
export function formatAmount(amount, currency, locale, signDisplay = "always") {
  return new Intl.NumberFormat(locale, { style: "currency", currency, signDisplay }).format(Number(amount));
}

// Dates are ISO strings without a time (e.g. "2026-11-12"): parsing them as UTC could show the previous day
export function formatDate(date, locale) {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(year, month - 1, day));
}

// Months are ISO strings like "2026-11"
export function formatMonth(month, locale, style = "long") {
  const [year, number] = month.split("-").map(Number);
  return new Intl.DateTimeFormat(locale, { month: style, year: "numeric" }).format(new Date(year, number - 1, 1));
}

export function addMonths(month, months) {
  const [year, number] = month.split("-").map(Number);
  const date = new Date(year, number - 1 + months, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function today() {
  const now = new Date();
  return [now.getFullYear(), now.getMonth() + 1, now.getDate()].map((part) => String(part).padStart(2, "0")).join("-");
}
