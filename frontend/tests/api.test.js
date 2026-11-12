import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiFetch, ApiError } from "@/api/client";
import { setLocale } from "@/i18n";

import { mockFetch } from "./helpers";

describe("apiFetch", () => {
  beforeEach(() => setLocale("en"));

  afterEach(() => {
    document.cookie = "csrftoken=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    vi.unstubAllGlobals();
  });

  it("sends GET requests without body nor CSRF token", async () => {
    document.cookie = "csrftoken=token";
    const fetch = mockFetch({ "GET /api/auth/me/": [200, { id: 1 }] });
    expect(await apiFetch("/auth/me/")).toEqual({ id: 1 });
    expect(fetch).toHaveBeenCalledWith("/api/auth/me/", {
      method: "GET",
      headers: { Accept: "application/json", "Accept-Language": "en" },
      credentials: "same-origin",
      body: undefined,
    });
  });

  it("sends JSON bodies with the CSRF token from the cookie", async () => {
    document.cookie = "other=1";
    document.cookie = "csrftoken=a%20token";
    const fetch = mockFetch({ "POST /api/auth/login/": [200, { id: 1 }] });
    await apiFetch("/auth/login/", { method: "POST", body: { email: "a@b.it" } });
    expect(fetch).toHaveBeenCalledWith("/api/auth/login/", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Accept-Language": "en",
        "Content-Type": "application/json",
        "X-CSRFToken": "a token",
      },
      credentials: "same-origin",
      body: '{"email":"a@b.it"}',
    });
  });

  it("sends form data as is, letting the browser set the content type", async () => {
    document.cookie = "csrftoken=token";
    const fetch = mockFetch({ "POST /api/transactions/import/": [201, { transactions: 1 }] });
    const body = new FormData();
    expect(await apiFetch("/transactions/import/", { method: "POST", body })).toEqual({ transactions: 1 });
    expect(fetch.mock.calls[0][1]).toMatchObject({
      headers: { Accept: "application/json", "Accept-Language": "en", "X-CSRFToken": "token" },
      body,
    });
  });

  it("omits the CSRF header when there is no cookie and returns null for empty responses", async () => {
    setLocale("it");
    const fetch = mockFetch({ "POST /api/auth/logout/": [204] });
    expect(await apiFetch("/auth/logout/", { method: "POST" })).toBeNull();
    expect(fetch.mock.calls[0][1].headers).toEqual({ Accept: "application/json", "Accept-Language": "it" });
  });

  it("throws an ApiError with status and data on failures", async () => {
    mockFetch({ "GET /api/auth/me/": [403, { detail: "Forbidden" }] });
    const error = await apiFetch("/auth/me/").catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.status).toBe(403);
    expect(error.data).toEqual({ detail: "Forbidden" });
    expect(error.message).toBe("API request failed with status 403");
  });
});
