import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMemoryHistory } from "vue-router";

import App from "@/App.vue";
import { auth } from "@/auth";
import { i18n, setLocale } from "@/i18n";
import { createAppRouter } from "@/router";

import { ADMIN, mockFetch, USER } from "./helpers";

async function mountAt(path) {
  const router = createAppRouter(createMemoryHistory());
  router.push(path);
  await router.isReady();
  const wrapper = mount(App, { global: { plugins: [router, i18n] } });
  await flushPromises();
  return { wrapper, router };
}

async function submitLogin(wrapper) {
  await wrapper.find("input[name=email]").setValue("anna@example.com");
  await wrapper.find("input[name=password]").setValue("secret");
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

describe("App", () => {
  beforeEach(() => {
    setLocale("en");
    Object.assign(auth, { user: null, ready: false, setupRequired: false });
  });

  afterEach(() => vi.unstubAllGlobals());

  describe("logged in", () => {
    beforeEach(() => {
      mockFetch({ "GET /api/auth/me/": [200, USER], "POST /api/auth/logout/": [204] });
    });

    it("renders the dashboard", async () => {
      const { wrapper } = await mountAt("/");
      expect(wrapper.find("h1").text()).toBe("Dashboard");
      expect(wrapper.text()).toContain("No data yet");
      expect(wrapper.find("header").text()).toContain("anna@example.com");
      expect(wrapper.find("header").text()).not.toContain("Users");
    });

    it("renders the not found page for unknown paths", async () => {
      const { wrapper } = await mountAt("/missing");
      expect(wrapper.find("h1").text()).toBe("Page not found");
    });

    it("switches language from the header", async () => {
      const { wrapper } = await mountAt("/");
      await wrapper.find("select").setValue("it");
      expect(i18n.global.locale.value).toBe("it");
      expect(wrapper.text()).toContain("Nessun dato ancora");
    });

    it("redirects away from the login page", async () => {
      const { router } = await mountAt("/login");
      expect(router.currentRoute.value.name).toBe("dashboard");
    });

    it("logs out and shows the login page", async () => {
      const { wrapper, router } = await mountAt("/");
      await wrapper.find("header button").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("login");
      expect(wrapper.find("h1").text()).toBe("Log in");
      expect(wrapper.find("header").text()).not.toContain("anna@example.com");
    });
  });

  describe("anonymous", () => {
    it("redirects to the login page and back after logging in", async () => {
      const fetch = mockFetch({ "GET /api/auth/me/": [403, {}], "POST /api/auth/login/": [200, USER] });
      const { wrapper, router } = await mountAt("/missing?x=1");
      expect(router.currentRoute.value.fullPath).toBe("/login?next=/missing?x=1");
      expect(wrapper.find("header button").exists()).toBe(false);

      await submitLogin(wrapper);
      expect(JSON.parse(fetch.mock.lastCall[1].body)).toEqual({ email: "anna@example.com", password: "secret" });
      expect(router.currentRoute.value.fullPath).toBe("/missing?x=1");
      expect(wrapper.find("header").text()).toContain("anna@example.com");
    });

    it.each(["//evil.example", "/\\evil.example", "https://evil.example"])(
      "ignores the unsafe next path %s",
      async (next) => {
        mockFetch({ "GET /api/auth/me/": [403, {}], "POST /api/auth/login/": [200, USER] });
        const { wrapper, router } = await mountAt({ name: "login", query: { next } });
        await submitLogin(wrapper);
        expect(router.currentRoute.value.fullPath).toBe("/");
      },
    );

    it.each([
      [400, "Invalid email or password."],
      [429, "Too many attempts: try again in a few minutes."],
      [500, "Login failed: try again later."],
    ])("shows an error when login fails with status %i", async (status, message) => {
      mockFetch({ "GET /api/auth/me/": [403, {}], "POST /api/auth/login/": [status, {}] });
      const { wrapper, router } = await mountAt("/login");
      await submitLogin(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe(message);
      expect(wrapper.find("button[type=submit]").attributes("disabled")).toBeUndefined();
      expect(router.currentRoute.value.name).toBe("login");
    });

    it("shows a generic error when the backend is unreachable", async () => {
      mockFetch({ "GET /api/auth/me/": [403, {}] });
      const { wrapper } = await mountAt("/login");
      fetch.mockRejectedValueOnce(new TypeError("Failed to fetch"));
      await submitLogin(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Login failed: try again later.");
    });
  });

  describe("setup", () => {
    const DATA = { first_name: "Anna", last_name: "", email: "anna@example.com", password: "Zx9!long-pass" };

    async function submitSetup(wrapper, { passwordConfirm = DATA.password } = {}) {
      for (const [name, value] of Object.entries({ ...DATA, password_confirm: passwordConfirm })) {
        await wrapper.find(`input[name=${name}]`).setValue(value);
      }
      await wrapper.find("form").trigger("submit");
      await flushPromises();
    }

    it("redirects to the setup page and logs in the first user", async () => {
      const fetch = mockFetch({
        "GET /api/auth/me/": [403, {}],
        "GET /api/setup/": [204],
        "POST /api/setup/": [201, USER],
      });
      const { wrapper, router } = await mountAt("/login");
      expect(router.currentRoute.value.name).toBe("setup");
      expect(wrapper.find("h1").text()).toBe("Welcome to Monely");

      await submitSetup(wrapper);
      expect(JSON.parse(fetch.mock.lastCall[1].body)).toEqual(DATA);
      expect(router.currentRoute.value.name).toBe("dashboard");
      expect(wrapper.find("header").text()).toContain("anna@example.com");
    });

    it("is not reachable once a user exists", async () => {
      mockFetch({ "GET /api/auth/me/": [403, {}] });
      const { router } = await mountAt("/setup");
      expect(router.currentRoute.value.name).toBe("login");
    });

    it("checks that the passwords match", async () => {
      const fetch = mockFetch({ "GET /api/auth/me/": [403, {}], "GET /api/setup/": [204] });
      const { wrapper } = await mountAt("/setup");
      await submitSetup(wrapper, { passwordConfirm: "other" });
      expect(wrapper.find("[role=alert]").text()).toBe("The passwords do not match.");
      expect(fetch).toHaveBeenCalledTimes(2);
    });

    it("shows the field errors returned by the backend", async () => {
      mockFetch({
        "GET /api/auth/me/": [403, {}],
        "GET /api/setup/": [204],
        "POST /api/setup/": [400, { password: ["This password is too common."] }],
      });
      const { wrapper, router } = await mountAt("/setup");
      await submitSetup(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Check the fields below.");
      expect(wrapper.find("input[name=password]").element.parentElement.textContent).toContain(
        "This password is too common.",
      );
      expect(wrapper.find("button[type=submit]").attributes("disabled")).toBeUndefined();
      expect(router.currentRoute.value.name).toBe("setup");
    });

    it("goes to the login page when the setup has already been completed", async () => {
      const fetch = mockFetch({ "GET /api/auth/me/": [403, {}], "GET /api/setup/": [204] });
      const { wrapper, router } = await mountAt("/setup");
      fetch.mockImplementation(async (url, { method }) => ({
        ok: false,
        status: method === "GET" && url === "/api/auth/me/" ? 403 : 404,
        json: async () => ({}),
      }));
      await submitSetup(wrapper);
      expect(router.currentRoute.value.name).toBe("login");
    });

    it("shows a generic error when the setup fails", async () => {
      mockFetch({ "GET /api/auth/me/": [403, {}], "GET /api/setup/": [204], "POST /api/setup/": [500, {}] });
      const { wrapper } = await mountAt("/setup");
      await submitSetup(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Setup failed: try again later.");
    });
  });

  describe("users", () => {
    const USERS = [
      { ...ADMIN, last_name: "Bianchi", is_active: true, last_login: "2026-11-12T10:30:00Z" },
      { ...USER, id: 2, email: "luca@example.com", first_name: "", is_active: false, last_login: null },
    ];

    it("lists the users from the header link", async () => {
      mockFetch({ "GET /api/auth/me/": [200, ADMIN], "GET /api/users/": [200, USERS] });
      const { wrapper, router } = await mountAt("/");
      await wrapper.find("header a[href='/users']").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("users");
      expect(wrapper.find("h1").text()).toBe("Users");

      const rows = wrapper.findAll("tbody tr").map((row) => row.findAll("td").map((cell) => cell.text()));
      expect(rows).toEqual([
        ["Anna Bianchi", "anna@example.com", "Admin", "Active", expect.stringContaining("2026")],
        ["—", "luca@example.com", "Member", "Inactive", "Never"],
      ]);
    });

    it("shows a loading message while fetching", async () => {
      mockFetch({ "GET /api/auth/me/": [200, ADMIN] });
      fetch.mockImplementation(async (url) =>
        url === "/api/users/" ? new Promise(() => {}) : { ok: true, status: 200, json: async () => ADMIN },
      );
      const { wrapper } = await mountAt("/users");
      expect(wrapper.text()).toContain("Loading…");
    });

    it("shows an error when the users cannot be loaded", async () => {
      mockFetch({ "GET /api/auth/me/": [200, ADMIN], "GET /api/users/": [500, {}] });
      const { wrapper } = await mountAt("/users");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the users: try again later.");
    });

    it("is not reachable by non admin users", async () => {
      mockFetch({ "GET /api/auth/me/": [200, USER] });
      const { router } = await mountAt("/users");
      expect(router.currentRoute.value.name).toBe("dashboard");
    });
  });
});
