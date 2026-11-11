import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth, authGuard, fetchUser, login, logout, setup } from "@/auth";

import { mockFetch, USER } from "./helpers";

describe("auth", () => {
  beforeEach(() => {
    Object.assign(auth, { user: null, ready: false, setupRequired: false });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("loads the current user", async () => {
    mockFetch({ "GET /api/auth/me/": [200, USER] });
    await fetchUser();
    expect(auth).toEqual({ user: USER, ready: true, setupRequired: false });
  });

  it("treats a failed session check as anonymous", async () => {
    mockFetch({ "GET /api/auth/me/": [403, { detail: "Forbidden" }] });
    auth.user = USER;
    await fetchUser();
    expect(auth).toEqual({ user: null, ready: true, setupRequired: false });
  });

  it("requires the setup when no user exists", async () => {
    mockFetch({ "GET /api/auth/me/": [403, {}], "GET /api/setup/": [204] });
    await fetchUser();
    expect(auth).toEqual({ user: null, ready: true, setupRequired: true });
  });

  it("creates the first user and logs in", async () => {
    const fetch = mockFetch({ "POST /api/setup/": [201, USER] });
    auth.setupRequired = true;
    await setup({ email: "anna@example.com", password: "secret" });
    expect(auth.user).toEqual(USER);
    expect(auth.setupRequired).toBe(false);
    expect(JSON.parse(fetch.mock.lastCall[1].body)).toEqual({ email: "anna@example.com", password: "secret" });
  });

  it("logs in and out", async () => {
    mockFetch({ "POST /api/auth/login/": [200, USER], "POST /api/auth/logout/": [204] });
    await login("anna@example.com", "secret");
    expect(auth.user).toEqual(USER);
    await logout();
    expect(auth.user).toBeNull();
  });

  describe("authGuard", () => {
    it("checks the session only once", async () => {
      const fetch = mockFetch({ "GET /api/auth/me/": [200, USER] });
      const to = { name: "dashboard", meta: {}, fullPath: "/" };
      expect(await authGuard(to)).toBe(true);
      expect(await authGuard(to)).toBe(true);
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("redirects anonymous users to the login page", async () => {
      mockFetch({ "GET /api/auth/me/": [403, {}] });
      expect(await authGuard({ name: "dashboard", meta: {}, fullPath: "/?month=1" })).toEqual({
        name: "login",
        query: { next: "/?month=1" },
      });
    });

    it("lets anonymous users reach public pages", async () => {
      auth.ready = true;
      expect(await authGuard({ name: "login", meta: { public: true } })).toBe(true);
    });

    it("sends everyone to the setup page while no user exists", async () => {
      Object.assign(auth, { ready: true, setupRequired: true });
      expect(await authGuard({ name: "login", meta: { public: true } })).toEqual({ name: "setup" });
      expect(await authGuard({ name: "setup", meta: {} })).toBe(true);
    });

    it("disables the setup page once a user exists", async () => {
      auth.ready = true;
      expect(await authGuard({ name: "setup", meta: {} })).toEqual({ name: "dashboard" });
    });

    it("sends logged in users away from the login page", async () => {
      Object.assign(auth, { user: USER, ready: true });
      expect(await authGuard({ name: "login", meta: { public: true } })).toEqual({ name: "dashboard" });
    });
  });
});
