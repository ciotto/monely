import { i18n } from "@/i18n";

export class ApiError extends Error {
  constructor(status, data) {
    super(`API request failed with status ${status}`);
    this.status = status;
    this.data = data;
  }
}

function getCookie(name) {
  const row = document.cookie.split("; ").find((cookie) => cookie.startsWith(`${name}=`));
  return row ? decodeURIComponent(row.slice(name.length + 1)) : null;
}

export async function apiFetch(path, { method = "GET", body } = {}) {
  // Django translates its messages (e.g. validation errors) in the UI language
  const headers = { Accept: "application/json", "Accept-Language": i18n.global.locale.value };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  // Django requires the CSRF token on unsafe methods for authenticated sessions
  const csrfToken = getCookie("csrftoken");
  if (method !== "GET" && csrfToken) {
    headers["X-CSRFToken"] = csrfToken;
  }
  const response = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: "same-origin",
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // Empty (204) or non JSON responses (e.g. a proxy error page) have no data
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(response.status, data);
  }
  return data;
}
