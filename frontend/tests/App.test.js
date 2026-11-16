import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { i18n, setLocale } from "@/i18n";

import { ADMIN, mockFetch, mountAt, USER } from "./helpers";

// The configuration links, the language and the logout live in the account menu
async function openMenu(wrapper) {
  await wrapper.find("header button[name=menu]").trigger("click");
}

async function submitLogin(wrapper) {
  await wrapper.find("input[name=email]").setValue("anna@example.com");
  await wrapper.find("input[name=password]").setValue("secret");
  await wrapper.find("form").trigger("submit");
  await flushPromises();
}

// Mounted apps would otherwise keep reacting to the shared auth state of the next tests
enableAutoUnmount(afterEach);

describe("App", () => {
  beforeEach(() => {
    setLocale("en");
    Object.assign(auth, { user: null, ready: false, setupRequired: false });
  });

  afterEach(() => vi.unstubAllGlobals());

  describe("logged in", () => {
    beforeEach(() => {
      mockFetch({
        "GET /api/auth/me/": [200, USER],
        "POST /api/auth/logout/": [204],
        "GET /api/wallets/": [200, []],
        "GET /api/categories/": [200, []],
        "GET /api/dashboard/": [
          200,
          { month: "2026-11", previous_month: "2026-10", previous_year: "2025-11", currencies: [], wallets: [] },
        ],
      });
    });

    it("renders the dashboard", async () => {
      const { wrapper } = await mountAt("/");
      expect(wrapper.find("h1").text()).toBe("Dashboard");
      expect(wrapper.text()).toContain("No data yet");
      expect(wrapper.find("header nav").text()).toBe("DashboardTransactionsBudget");
      expect(wrapper.find("header").text()).toContain("anna@example.com");
      expect(wrapper.find("header").text()).not.toContain("Wallets");

      await openMenu(wrapper);
      expect(wrapper.find("header button[name=menu]").attributes("aria-expanded")).toBe("true");
      expect(wrapper.find("header").text()).toContain("SettingsWalletsCategoriesTagsRecurring transactions");
      expect(wrapper.find("header").text()).not.toContain("Users");
      expect(wrapper.find("header a[href='/maintenance']").exists()).toBe(false);
    });

    it("closes the account menu on outside clicks, escape and navigation", async () => {
      // Attached to the document, so that the clicks inside the menu reach its listener
      const { wrapper, router } = await mountAt("/", { attachTo: document.body });
      const isOpen = () => wrapper.find("header a[href='/wallets']").exists();

      await openMenu(wrapper);
      await wrapper.find("header select").trigger("click");
      expect(isOpen()).toBe(true);
      document.dispatchEvent(new MouseEvent("click"));
      await flushPromises();
      expect(isOpen()).toBe(false);

      await openMenu(wrapper);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
      await flushPromises();
      expect(isOpen()).toBe(true);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
      await flushPromises();
      expect(isOpen()).toBe(false);

      await openMenu(wrapper);
      await openMenu(wrapper);
      expect(isOpen()).toBe(false);

      await openMenu(wrapper);
      await router.push({ name: "transactions" });
      await flushPromises();
      expect(isOpen()).toBe(false);
    });

    it("renders the not found page for unknown paths", async () => {
      const { wrapper } = await mountAt("/missing");
      expect(wrapper.find("h1").text()).toBe("Page not found");
    });

    it("switches language from the header", async () => {
      const { wrapper } = await mountAt("/");
      await openMenu(wrapper);
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
      await openMenu(wrapper);
      await wrapper.find("header button[name=logout]").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("login");
      expect(wrapper.find("h1").text()).toBe("Log in");
      expect(wrapper.find("header").text()).not.toContain("anna@example.com");
    });
  });

  describe("anonymous", () => {
    it("switches language from the header without the account menu", async () => {
      mockFetch({ "GET /api/auth/me/": [403, {}] });
      const { wrapper } = await mountAt("/login");
      expect(wrapper.find("header button[name=menu]").exists()).toBe(false);
      await wrapper.find("header select").setValue("it");
      expect(i18n.global.locale.value).toBe("it");
      expect(wrapper.find("h1").text()).toBe("Accedi");
    });

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
      const [, { body }] = fetch.mock.calls.find(([url, { method }]) => url === "/api/setup/" && method === "POST");
      expect(JSON.parse(body)).toEqual(DATA);
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
      await openMenu(wrapper);
      await wrapper.find("header a[href='/users']").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("users");
      expect(wrapper.find("h1").text()).toBe("Users");

      const rows = wrapper.findAll("tbody tr").map((row) => row.findAll("td").map((cell) => cell.text()));
      expect(rows).toEqual([
        ["Anna Bianchi", "anna@example.com", "Admin", "Active", expect.stringContaining("2026"), "Edit"],
        ["—", "luca@example.com", "Member", "Inactive", "Never", "EditDelete"],
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

    describe("deletion", () => {
      afterEach(() => vi.restoreAllMocks());

      it("deletes another user after confirmation", async () => {
        const fetch = mockFetch({
          "GET /api/auth/me/": [200, ADMIN],
          "GET /api/users/": [200, USERS],
          "DELETE /api/users/2/": [204],
        });
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
        const { wrapper } = await mountAt("/users");
        expect(wrapper.findAll("tbody button")).toHaveLength(1);

        await wrapper.find("tbody button").trigger("click");
        await flushPromises();
        expect(confirm).toHaveBeenCalledWith("Delete the user luca@example.com? This cannot be undone.");
        expect(fetch).toHaveBeenLastCalledWith("/api/users/2/", expect.objectContaining({ method: "DELETE" }));
        expect(wrapper.findAll("tbody tr")).toHaveLength(1);
      });

      it("does nothing when the deletion is not confirmed", async () => {
        const fetch = mockFetch({ "GET /api/auth/me/": [200, ADMIN], "GET /api/users/": [200, USERS] });
        vi.spyOn(window, "confirm").mockReturnValue(false);
        const { wrapper } = await mountAt("/users");
        await wrapper.find("tbody button").trigger("click");
        await flushPromises();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(wrapper.findAll("tbody tr")).toHaveLength(2);
      });

      it("shows an error when the deletion fails", async () => {
        mockFetch({
          "GET /api/auth/me/": [200, ADMIN],
          "GET /api/users/": [200, USERS],
          "DELETE /api/users/2/": [500, {}],
        });
        vi.spyOn(window, "confirm").mockReturnValue(true);
        const { wrapper } = await mountAt("/users");
        await wrapper.find("tbody button").trigger("click");
        await flushPromises();
        expect(wrapper.find("[role=alert]").text()).toBe("Unable to delete the user: try again later.");
        expect(wrapper.findAll("tbody tr")).toHaveLength(2);
      });
    });
  });

  describe("user form", () => {
    async function fill(wrapper, values) {
      for (const [name, value] of Object.entries(values)) {
        const input = wrapper.find(`input[name=${name}]`);
        await (typeof value === "boolean" ? input.setChecked(value) : input.setValue(value));
      }
      await wrapper.find("form").trigger("submit");
      await flushPromises();
    }

    it("creates a user from the list page", async () => {
      const fetch = mockFetch({
        "GET /api/auth/me/": [200, ADMIN],
        "GET /api/users/": [200, []],
        "POST /api/users/": [201, { ...USER, id: 3 }],
      });
      const { wrapper, router } = await mountAt("/users");
      await wrapper.find("a[href='/users/new']").trigger("click");
      await flushPromises();
      expect(wrapper.find("h1").text()).toBe("New user");
      expect(wrapper.find("input[name=password]").attributes("required")).toBeDefined();

      await fill(wrapper, {
        first_name: "Luca",
        email: "luca@example.com",
        password: "Zx9!long-pass",
        password_confirm: "Zx9!long-pass",
        is_staff: true,
      });
      expect(JSON.parse(fetch.mock.calls.at(-2)[1].body)).toEqual({
        first_name: "Luca",
        last_name: "",
        email: "luca@example.com",
        is_staff: true,
        is_active: true,
        password: "Zx9!long-pass",
      });
      expect(router.currentRoute.value.name).toBe("users");
    });

    it("edits a user keeping the current password", async () => {
      const other = { ...USER, id: 2, email: "luca@example.com", is_active: true };
      const fetch = mockFetch({
        "GET /api/auth/me/": [200, ADMIN],
        "GET /api/users/2/": [200, other],
        "PATCH /api/users/2/": [200, other],
        "GET /api/users/": [200, [other]],
      });
      const { wrapper, router } = await mountAt("/users/2");
      expect(wrapper.find("h1").text()).toBe("Edit user");
      expect(wrapper.find("input[name=email]").element.value).toBe("luca@example.com");
      expect(wrapper.find("input[name=password]").attributes("required")).toBeUndefined();
      expect(wrapper.text()).toContain("Leave the password empty to keep the current one.");

      await fill(wrapper, { last_name: "Verdi", is_active: false });
      const [url, { method, body }] = fetch.mock.calls.at(-2);
      expect([url, method]).toEqual(["/api/users/2/", "PATCH"]);
      expect(JSON.parse(body)).toEqual({
        first_name: "Anna",
        last_name: "Verdi",
        email: "luca@example.com",
        is_staff: false,
        is_active: false,
      });
      expect(router.currentRoute.value.name).toBe("users");
      expect(auth.user.email).toBe("anna@example.com");
    });

    it("edits the own account updating the header", async () => {
      mockFetch({
        "GET /api/auth/me/": [200, ADMIN],
        "GET /api/users/1/": [200, { ...ADMIN, is_active: true }],
        "PATCH /api/users/1/": [200, { ...ADMIN, email: "boss@example.com" }],
        "GET /api/users/": [200, []],
      });
      const { wrapper } = await mountAt("/users/1");
      expect(wrapper.find("input[name=is_staff]").attributes("disabled")).toBeDefined();
      expect(wrapper.text()).toContain("You cannot change the role or the status of your own account.");

      await fill(wrapper, { email: "boss@example.com", password: "Zx9!new-pass", password_confirm: "Zx9!new-pass" });
      expect(wrapper.find("header").text()).toContain("boss@example.com");
    });

    it("checks that the passwords match", async () => {
      const fetch = mockFetch({ "GET /api/auth/me/": [200, ADMIN] });
      const { wrapper } = await mountAt("/users/new");
      await fill(wrapper, { email: "luca@example.com", password: "a", password_confirm: "b" });
      expect(wrapper.find("[role=alert]").text()).toBe("The passwords do not match.");
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it("shows the field errors returned by the backend", async () => {
      mockFetch({
        "GET /api/auth/me/": [200, ADMIN],
        "POST /api/users/": [
          400,
          {
            email: ["A user with that email address already exists."],
            password: ["This password is too common."],
            is_staff: ["Must be a valid boolean."],
          },
        ],
      });
      const { wrapper, router } = await mountAt("/users/new");
      await fill(wrapper, { email: "anna@example.com", password: "x", password_confirm: "x" });
      expect(wrapper.find("[role=alert]").text()).toBe("Check the fields below.");
      const fieldText = (name) => wrapper.find(`input[name=${name}]`).element.closest("label").textContent;
      expect(fieldText("email")).toContain("A user with that email address already exists.");
      expect(fieldText("password")).toContain("This password is too common.");
      expect(fieldText("is_staff")).toContain("Must be a valid boolean.");
      expect(router.currentRoute.value.name).toBe("user-new");
    });

    it("shows a generic error when saving fails", async () => {
      mockFetch({ "GET /api/auth/me/": [200, ADMIN], "POST /api/users/": [500, {}] });
      const { wrapper } = await mountAt("/users/new");
      await fill(wrapper, { email: "luca@example.com", password: "x", password_confirm: "x" });
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to save the user: try again later.");
      expect(wrapper.find("button[type=submit]").attributes("disabled")).toBeUndefined();
    });

    it("shows an error when the user cannot be loaded", async () => {
      mockFetch({ "GET /api/auth/me/": [200, ADMIN] });
      const { wrapper } = await mountAt("/users/9");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the user.");
      expect(wrapper.find("form").exists()).toBe(false);
    });
  });

  describe("wallets", () => {
    const OWNERS = [
      { id: 1, email: "anna@example.com", first_name: "Anna", last_name: "Bianchi" },
      { id: 2, email: "luca@example.com", first_name: "", last_name: "" },
    ];
    const WALLETS = [
      { id: 1, name: "Bank", currency: "EUR", owners: [1], is_archived: false, is_shared: false },
      { id: 2, name: "Old card", currency: "USD", owners: [2], is_archived: true, is_shared: false },
      { id: 3, name: "Joint", currency: "EUR", owners: [], is_archived: false, is_shared: true },
    ];

    const rows = (wrapper) => wrapper.findAll("tbody tr").map((row) => row.findAll("td").map((cell) => cell.text()));

    it("lists the active wallets from the header link", async () => {
      mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/": [200, WALLETS],
        "GET /api/wallets/owners/": [200, OWNERS],
      });
      const { wrapper, router } = await mountAt("/");
      await openMenu(wrapper);
      await wrapper.find("header a[href='/wallets']").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("wallets");
      expect(wrapper.find("h1").text()).toBe("Wallets");
      expect(wrapper.findAll("thead th").map((cell) => cell.text())).toEqual([
        "Name",
        "Currency",
        "Owner",
        "Status",
        "Actions",
      ]);
      // The joint wallets belong to the whole family
      expect(rows(wrapper)).toEqual([
        ["Bank", "EUR", "Anna Bianchi", "Active", "EditArchive"],
        ["Joint", "EUR", "Family", "Active", "EditArchive"],
      ]);

      await wrapper.find("input[name=show_archived]").setChecked(true);
      expect(rows(wrapper)[1]).toEqual(["Old card", "USD", "luca@example.com", "Archived", "EditRestore"]);
    });

    it("links the import of the statements of the active wallets with an import format", async () => {
      const importFormat = { date_column: "Data", amount_column: "Importo" };
      mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/": [
          200,
          [
            { ...WALLETS[0], import_format: importFormat },
            { ...WALLETS[1], import_format: importFormat },
            { ...WALLETS[2], import_format: null },
          ],
        ],
        "GET /api/wallets/owners/": [200, OWNERS],
      });
      const { wrapper } = await mountAt("/wallets");
      await wrapper.find("input[name=show_archived]").setChecked(true);
      expect(rows(wrapper).map((row) => row[4])).toEqual(["Import statementEditArchive", "EditRestore", "EditArchive"]);
      expect(wrapper.find("a[href='/wallets/1/import']").exists()).toBe(true);
    });

    it("shows a message when there are no wallets", async () => {
      mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/": [200, [WALLETS[1]]],
        "GET /api/wallets/owners/": [200, OWNERS],
      });
      const { wrapper } = await mountAt("/wallets");
      expect(wrapper.text()).toContain("No wallets yet: create the first one.");
      expect(wrapper.find("table").exists()).toBe(false);
    });

    it("shows a loading message while fetching", async () => {
      mockFetch({ "GET /api/auth/me/": [200, USER] });
      fetch.mockImplementation(async (url) =>
        url === "/api/auth/me/" ? { ok: true, status: 200, json: async () => USER } : new Promise(() => {}),
      );
      const { wrapper } = await mountAt("/wallets");
      expect(wrapper.text()).toContain("Loading…");
    });

    it("shows an error when the wallets cannot be loaded", async () => {
      mockFetch({ "GET /api/auth/me/": [200, USER], "GET /api/wallets/owners/": [200, OWNERS] });
      const { wrapper } = await mountAt("/wallets");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the wallets: try again later.");
    });

    it("archives and restores a wallet", async () => {
      const fetch = mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/": [200, structuredClone(WALLETS.slice(0, 2))],
        "GET /api/wallets/owners/": [200, OWNERS],
        "PATCH /api/wallets/1/": [200, { ...WALLETS[0], is_archived: true }],
      });
      const { wrapper } = await mountAt("/wallets");
      await wrapper.find("tbody button").trigger("click");
      await flushPromises();
      expect(fetch).toHaveBeenLastCalledWith(
        "/api/wallets/1/",
        expect.objectContaining({ method: "PATCH", body: JSON.stringify({ is_archived: true }) }),
      );
      expect(wrapper.text()).toContain("No wallets yet");

      await wrapper.find("input[name=show_archived]").setChecked(true);
      await wrapper.find("tbody button").trigger("click");
      await flushPromises();
      expect(JSON.parse(fetch.mock.lastCall[1].body)).toEqual({ is_archived: false });
    });

    it("shows an error when archiving fails", async () => {
      mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/": [200, structuredClone(WALLETS.slice(0, 2))],
        "GET /api/wallets/owners/": [200, OWNERS],
        "PATCH /api/wallets/1/": [500, {}],
      });
      const { wrapper } = await mountAt("/wallets");
      await wrapper.find("tbody button").trigger("click");
      await flushPromises();
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to update the wallet: try again later.");
      expect(rows(wrapper)[0][3]).toBe("Active");
    });
  });

  describe("wallet form", () => {
    const OWNERS = [
      { id: 1, email: "anna@example.com", first_name: "Anna", last_name: "" },
      { id: 2, email: "luca@example.com", first_name: "", last_name: "" },
    ];

    async function fill(wrapper, values) {
      for (const [name, value] of Object.entries(values)) {
        await wrapper.find(`input[name=${name}]`).setValue(value);
      }
    }

    async function submit(wrapper) {
      await wrapper.find("form").trigger("submit");
      await flushPromises();
    }

    it("creates a wallet owned by the current user", async () => {
      const fetch = mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/": [200, []],
        "GET /api/wallets/owners/": [200, OWNERS],
        "POST /api/wallets/": [201, {}],
      });
      const { wrapper, router } = await mountAt("/wallets");
      await wrapper.find("a[href='/wallets/new']").trigger("click");
      await flushPromises();
      expect(wrapper.find("h1").text()).toBe("New wallet");
      expect(wrapper.find("input[name=currency]").element.value).toBe("EUR");
      expect(wrapper.find("input[name=is_archived]").exists()).toBe(false);
      // A single owner, the current user unless chosen otherwise
      const owners = wrapper.findAll("input[name=owner]");
      expect(owners.map((input) => input.attributes("type"))).toEqual(["radio", "radio"]);
      expect(owners.map((input) => input.element.checked)).toEqual([true, false]);
      expect(wrapper.find("fieldset").text()).toContain("luca@example.com");

      await fill(wrapper, { name: "Card", currency: "usd" });
      await owners[1].setChecked(true);
      await submit(wrapper);
      const [url, { method, body }] = fetch.mock.calls.at(-3);
      expect([url, method]).toEqual(["/api/wallets/", "POST"]);
      expect(JSON.parse(body)).toEqual({
        name: "Card",
        currency: "USD",
        owners: [2],
        is_archived: false,
        is_shared: false,
        import_format: null,
      });
      expect(router.currentRoute.value.name).toBe("wallets");
    });

    it("creates a joint wallet", async () => {
      const fetch = mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/owners/": [200, OWNERS],
        "POST /api/wallets/": [201, {}],
        "GET /api/wallets/": [200, []],
      });
      const { wrapper } = await mountAt("/wallets/new");
      expect(wrapper.text()).not.toContain("It receives the family contributions");

      await wrapper.find("input[name=is_shared]").setChecked(true);
      expect(wrapper.text()).toContain("It receives the family contributions");
      // It belongs to the whole family
      expect(wrapper.find("input[name=owner]").exists()).toBe(false);
      await fill(wrapper, { name: "Joint account" });
      await submit(wrapper);
      const [url, { method, body }] = fetch.mock.calls.at(-3);
      expect([url, method]).toEqual(["/api/wallets/", "POST"]);
      expect(JSON.parse(body)).toMatchObject({ name: "Joint account", is_shared: true, owners: [] });
    });

    it("edits a wallet without changing the currency", async () => {
      const wallet = {
        id: 3,
        name: "Bank",
        currency: "EUR",
        owners: [2],
        is_archived: false,
        is_shared: false,
      };
      const fetch = mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/owners/": [200, OWNERS],
        "GET /api/wallets/3/": [200, wallet],
        "PATCH /api/wallets/3/": [200, wallet],
        "GET /api/wallets/": [200, [wallet]],
      });
      const { wrapper, router } = await mountAt("/wallets/3");
      expect(wrapper.find("h1").text()).toBe("Edit wallet");
      expect(wrapper.find("input[name=name]").element.value).toBe("Bank");
      expect(wrapper.find("input[name=currency]").attributes("disabled")).toBeDefined();
      expect(wrapper.text()).toContain("The currency cannot be changed.");
      expect(wrapper.findAll("input[name=owner]").map((input) => input.element.checked)).toEqual([false, true]);
      expect(wrapper.find("input[name=is_shared]").element.checked).toBe(false);

      await fill(wrapper, { name: "Main bank" });
      await wrapper.find("input[name=is_archived]").setChecked(true);
      await submit(wrapper);
      const [url, { method, body }] = fetch.mock.calls.at(-3);
      expect([url, method]).toEqual(["/api/wallets/3/", "PATCH"]);
      expect(JSON.parse(body)).toEqual({
        name: "Main bank",
        owners: [2],
        is_archived: true,
        is_shared: false,
        import_format: null,
      });
      expect(router.currentRoute.value.name).toBe("wallets");
    });

    it("turns a joint wallet into a personal one of the current user", async () => {
      const wallet = { id: 3, name: "Joint", currency: "EUR", owners: [], is_archived: false, is_shared: true };
      const fetch = mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/owners/": [200, OWNERS],
        "GET /api/wallets/3/": [200, wallet],
        "PATCH /api/wallets/3/": [200, wallet],
        "GET /api/wallets/": [200, [wallet]],
      });
      const { wrapper } = await mountAt("/wallets/3");
      expect(wrapper.find("input[name=owner]").exists()).toBe(false);

      await wrapper.find("input[name=is_shared]").setChecked(false);
      expect(wrapper.findAll("input[name=owner]").map((input) => input.element.checked)).toEqual([true, false]);
      await submit(wrapper);
      const [, { body }] = fetch.mock.calls.at(-3);
      expect(JSON.parse(body)).toMatchObject({ owners: [1], is_shared: false });
    });

    it("creates a wallet with the import format of its statements", async () => {
      const fetch = mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/owners/": [200, OWNERS],
        "POST /api/wallets/": [201, {}],
        "GET /api/wallets/": [200, []],
      });
      const { wrapper } = await mountAt("/wallets/new");
      expect(wrapper.find("input[name=date_column]").exists()).toBe(false);

      await wrapper.find("input[name=import_enabled]").setChecked(true);
      expect(wrapper.find("input[name=amount_mode][value=signed]").element.checked).toBe(true);
      expect(wrapper.find("input[name=income_column]").exists()).toBe(false);
      expect(wrapper.findAll("select[name=date_format] option").map((option) => option.text())).toEqual([
        "31/12/2026",
        "31/12/26",
        "31-12-2026",
        "31.12.2026",
        "2026-12-31",
        "12/31/2026",
      ]);
      expect(wrapper.findAll("select[name=delimiter] option").map((option) => option.text())).toEqual([
        "Semicolon",
        "Comma",
        "Tab",
      ]);
      await fill(wrapper, {
        name: "Bank",
        date_column: "Data contabile",
        amount_column: "Importo",
        description_column: "Descrizione",
      });
      await wrapper.find("select[name=date_format]").setValue("%Y-%m-%d");
      await wrapper.find("select[name=decimal_separator]").setValue(".");
      await wrapper.find("select[name=delimiter]").setValue("\t");
      await wrapper.find("input[name=negate_amounts]").setChecked(true);
      await submit(wrapper);
      const [url, { method, body }] = fetch.mock.calls.at(-3);
      expect([url, method]).toEqual(["/api/wallets/", "POST"]);
      expect(JSON.parse(body).import_format).toEqual({
        date_column: "Data contabile",
        date_format: "%Y-%m-%d",
        amount_column: "Importo",
        income_column: "",
        expense_column: "",
        description_column: "Descrizione",
        decimal_separator: ".",
        delimiter: "\t",
        negate_amounts: true,
      });
    });

    it("edits the import format with income and expense columns", async () => {
      const importFormat = {
        date_column: "Data",
        date_format: "%d/%m/%Y",
        amount_column: "",
        income_column: "Entrate",
        expense_column: "Uscite",
        description_column: "Descrizione",
        decimal_separator: ",",
        delimiter: ";",
        negate_amounts: false,
      };
      const wallet = { id: 3, name: "Bank", currency: "EUR", owners: [1], is_archived: false, is_shared: false };
      const fetch = mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/owners/": [200, OWNERS],
        "GET /api/wallets/3/": [200, { ...wallet, import_format: importFormat }],
        "PATCH /api/wallets/3/": [
          400,
          {
            import_format: {
              date_column: ["This field may not be blank."],
              amount_column: ["Set the amount column, or both the income and the expense columns."],
            },
          },
        ],
      });
      const { wrapper } = await mountAt("/wallets/3");
      expect(wrapper.find("input[name=import_enabled]").element.checked).toBe(true);
      expect(wrapper.find("input[name=amount_mode][value=split]").element.checked).toBe(true);
      expect(wrapper.find("input[name=amount_column]").exists()).toBe(false);
      expect(wrapper.find("input[name=income_column]").element.value).toBe("Entrate");
      expect(wrapper.find("input[name=description_column]").element.value).toBe("Descrizione");

      await fill(wrapper, { expense_column: "Addebiti" });
      await submit(wrapper);
      const [, { body }] = fetch.mock.calls.findLast(([, { method }]) => method === "PATCH");
      expect(JSON.parse(body).import_format).toEqual({ ...importFormat, expense_column: "Addebiti" });
      expect(wrapper.find("input[name=date_column]").element.closest("label").textContent).toContain(
        "This field may not be blank.",
      );
      expect(wrapper.find("input[name=income_column]").element.closest("div").textContent).toContain(
        "Set the amount column",
      );

      // A single column drops the other ones
      await wrapper.find("input[name=amount_mode][value=signed]").setChecked(true);
      await fill(wrapper, { amount_column: "Importo" });
      await submit(wrapper);
      expect(wrapper.find("input[name=amount_column]").element.closest("label").textContent).toContain(
        "Set the amount column",
      );
      const [, { body: signed }] = fetch.mock.calls.findLast(([, { method }]) => method === "PATCH");
      expect(JSON.parse(signed).import_format).toMatchObject({
        amount_column: "Importo",
        income_column: "",
        expense_column: "",
      });

      // Without the import, the format is removed
      await wrapper.find("input[name=import_enabled]").setChecked(false);
      await submit(wrapper);
      const [, { body: disabled }] = fetch.mock.calls.findLast(([, { method }]) => method === "PATCH");
      expect(JSON.parse(disabled).import_format).toBeNull();
    });

    it("loads an import format with a single amount column", async () => {
      const wallet = { id: 3, name: "Bank", currency: "EUR", owners: [1], is_archived: false, is_shared: false };
      mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/owners/": [200, OWNERS],
        "GET /api/wallets/3/": [
          200,
          { ...wallet, import_format: { date_column: "Data", amount_column: "Importo", delimiter: "\t" } },
        ],
      });
      const { wrapper } = await mountAt("/wallets/3");
      expect(wrapper.find("input[name=amount_mode][value=signed]").element.checked).toBe(true);
      expect(wrapper.find("input[name=amount_column]").element.value).toBe("Importo");
      expect(wrapper.find("select[name=delimiter]").element.value).toBe("\t");
    });

    it("shows the field errors returned by the backend", async () => {
      mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/owners/": [200, OWNERS],
        "POST /api/wallets/": [
          400,
          {
            name: ["Ensure this field has no more than 100 characters."],
            currency: ["Enter a three-letter ISO 4217 currency code, e.g. EUR."],
            owners: ["Invalid pk."],
          },
        ],
      });
      const { wrapper, router } = await mountAt("/wallets/new");
      await fill(wrapper, { name: "Cash", currency: "E1R" });
      await submit(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Check the fields below.");
      expect(wrapper.find("input[name=name]").element.closest("label").textContent).toContain("no more than 100");
      expect(wrapper.find("input[name=currency]").element.closest("label").textContent).toContain(
        "Enter a three-letter ISO 4217 currency code",
      );
      expect(wrapper.find("fieldset").text()).toContain("Invalid pk.");
      expect(wrapper.find("button[type=submit]").attributes("disabled")).toBeUndefined();
      expect(router.currentRoute.value.name).toBe("wallet-new");
    });

    it("shows a generic error when saving fails", async () => {
      mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/wallets/owners/": [200, OWNERS],
        "POST /api/wallets/": [500, {}],
      });
      const { wrapper } = await mountAt("/wallets/new");
      await fill(wrapper, { name: "Cash" });
      await submit(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to save the wallet: try again later.");
    });

    it("shows an error when the wallet cannot be loaded", async () => {
      mockFetch({ "GET /api/auth/me/": [200, USER], "GET /api/wallets/owners/": [200, OWNERS] });
      const { wrapper } = await mountAt("/wallets/9");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the wallet.");
      expect(wrapper.find("form").exists()).toBe(false);
    });
  });

  describe("categories and tags", () => {
    const CATEGORIES = [
      { id: 1, name: "Groceries", color: "#16a34a", icon: "shopping-cart" },
      { id: 2, name: "Rent", color: "#2563eb", icon: "" },
    ];

    // The Lucide icon shown inside an element, as its kebab-case name
    const iconOf = (element) =>
      element
        .find("svg")
        .classes()
        .find((name) => name.startsWith("lucide-"))
        .slice("lucide-".length);

    async function pickIcon(wrapper, picker, icon) {
      await wrapper.find(`button[name=${picker}]`).trigger("click");
      await wrapper.find(`button[data-icon="${icon}"]`).trigger("click");
    }

    const names = (wrapper) => wrapper.findAll("li").map((item) => item.find("[data-name]").text());

    async function mountCategories(responses = {}) {
      const fetch = mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/categories/": [200, structuredClone(CATEGORIES)],
        ...responses,
      });
      return { fetch, ...(await mountAt("/categories")) };
    }

    async function submit(form) {
      await form.trigger("submit");
      await flushPromises();
    }

    it("lists the categories and the tags from the header links", async () => {
      mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/categories/": [200, CATEGORIES],
        "GET /api/tags/": [200, [{ id: 1, name: "car", color: "#d97706" }]],
      });
      const { wrapper, router } = await mountAt("/");
      await openMenu(wrapper);
      await wrapper.find("header a[href='/categories']").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("categories");
      expect(wrapper.find("h1").text()).toBe("Categories");
      expect(names(wrapper)).toEqual(["Groceries", "Rent"]);
      const [groceries, rent] = wrapper.findAll("li");
      expect(iconOf(groceries)).toBe("shopping-cart");
      expect(groceries.find("[data-icon]").element.style.color).toBe("rgb(22, 163, 74)");
      expect(rent.find("[data-icon]").exists()).toBe(false);
      expect(rent.find(".rounded-full").element.style.backgroundColor).toBe("rgb(37, 99, 235)");
      expect(wrapper.find("button[name=icon]").exists()).toBe(true);

      await openMenu(wrapper);
      await wrapper.find("header a[href='/tags']").trigger("click");
      await flushPromises();
      expect(wrapper.find("h1").text()).toBe("Tags");
      expect(names(wrapper)).toEqual(["car"]);
      expect(wrapper.find("button[name=icon]").exists()).toBe(false);
      expect(wrapper.find("input[name=color]").element.value).toBe("#16a34a");
    });

    it("shows a loading message while fetching", async () => {
      mockFetch({ "GET /api/auth/me/": [200, USER] });
      fetch.mockImplementation(async (url) =>
        url === "/api/auth/me/" ? { ok: true, status: 200, json: async () => USER } : new Promise(() => {}),
      );
      const { wrapper } = await mountAt("/tags");
      expect(wrapper.text()).toContain("Loading…");
    });

    it("adds a tag without icon", async () => {
      const fetch = mockFetch({
        "GET /api/auth/me/": [200, USER],
        "GET /api/tags/": [200, []],
        "POST /api/tags/": [201, { id: 1, name: "car", color: "#0891b2" }],
      });
      const { wrapper } = await mountAt("/tags");
      expect(wrapper.text()).toContain("No tags yet: add the first one.");
      await wrapper.find("input[name=color]").setValue("#0891b2");
      await wrapper.find("input[name=name]").setValue("car");
      await submit(wrapper.find("form"));
      expect(JSON.parse(fetch.mock.lastCall[1].body)).toEqual({ name: "car", color: "#0891b2" });
      expect(names(wrapper)).toEqual(["car"]);
      expect(wrapper.find("input[name=color]").element.value).toBe("#16a34a");
    });

    it("shows an error when the items cannot be loaded", async () => {
      mockFetch({ "GET /api/auth/me/": [200, USER] });
      const { wrapper } = await mountAt("/tags");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the tags: try again later.");
    });

    it("adds a category keeping the list sorted", async () => {
      const bills = { id: 3, name: "Bills", color: "#dc2626", icon: "lightbulb" };
      const { wrapper, fetch } = await mountCategories({ "POST /api/categories/": [201, bills] });
      expect(wrapper.find("input[name=color]").element.value).toBe("#dc2626");
      await pickIcon(wrapper, "icon", "lightbulb");
      expect(iconOf(wrapper.find("button[name=icon]"))).toBe("lightbulb");
      await wrapper.find("input[name=name]").setValue("Bills");
      await submit(wrapper.find("form"));
      const [url, { method, body }] = fetch.mock.lastCall;
      expect([url, method]).toEqual(["/api/categories/", "POST"]);
      expect(JSON.parse(body)).toEqual({ name: "Bills", color: "#dc2626", icon: "lightbulb" });
      expect(names(wrapper)).toEqual(["Bills", "Groceries", "Rent"]);
      expect(wrapper.find("input[name=name]").element.value).toBe("");
      expect(iconOf(wrapper.find("button[name=icon]"))).toBe("ban");
      expect(wrapper.find("input[name=color]").element.value).toBe("#d97706");
    });

    it("shows the name errors returned by the backend", async () => {
      const { wrapper } = await mountCategories({
        "POST /api/categories/": [
          400,
          { name: ["This name is already in use."], color: ["Enter a hexadecimal color, e.g. #2563eb."] },
        ],
      });
      await wrapper.find("input[name=name]").setValue("rent");
      await submit(wrapper.find("form"));
      expect(wrapper.find("form").text()).toContain("This name is already in use.");
      expect(wrapper.find("form").text()).toContain("Enter a hexadecimal color, e.g. #2563eb.");
      expect(names(wrapper)).toEqual(["Groceries", "Rent"]);
    });

    it("shows a generic error when saving fails", async () => {
      const { wrapper } = await mountCategories({ "POST /api/categories/": [500, {}] });
      await wrapper.find("input[name=name]").setValue("Bills");
      await submit(wrapper.find("form"));
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to save the category: try again later.");
    });

    it("edits a category", async () => {
      const taxes = { id: 1, name: "Taxes", color: "#7c3aed", icon: "receipt" };
      const { wrapper, fetch } = await mountCategories({ "PATCH /api/categories/1/": [200, taxes] });
      await wrapper.find("li button").trigger("click");
      expect(wrapper.find("input[name=edit_name]").element.value).toBe("Groceries");
      expect(wrapper.find("input[name=edit_color]").element.value).toBe("#16a34a");
      expect(iconOf(wrapper.find("button[name=edit_icon]"))).toBe("shopping-cart");

      await wrapper.find("input[name=edit_name]").setValue("Taxes");
      await wrapper.find("input[name=edit_color]").setValue("#7c3aed");
      await pickIcon(wrapper, "edit_icon", "receipt");
      await submit(wrapper.find("li form"));
      const [url, { method, body }] = fetch.mock.lastCall;
      expect([url, method]).toEqual(["/api/categories/1/", "PATCH"]);
      expect(JSON.parse(body)).toEqual({ name: "Taxes", color: "#7c3aed", icon: "receipt" });
      expect(names(wrapper)).toEqual(["Rent", "Taxes"]);
      expect(wrapper.find("input[name=edit_name]").exists()).toBe(false);
    });

    it("keeps the rename form open on errors and can be cancelled", async () => {
      const { wrapper } = await mountCategories({
        "PATCH /api/categories/1/": [400, { name: ["This name is already in use."] }],
      });
      await wrapper.find("li button").trigger("click");
      await wrapper.find("input[name=edit_name]").setValue("rent");
      await submit(wrapper.find("li form"));
      expect(wrapper.find("li form").text()).toContain("This name is already in use.");

      await wrapper.findAll("li form button[type=button]").at(-1).trigger("click");
      expect(wrapper.find("li form").exists()).toBe(false);
      expect(names(wrapper)).toEqual(["Groceries", "Rent"]);
    });

    describe("deletion", () => {
      afterEach(() => vi.restoreAllMocks());

      it("deletes a category after confirmation", async () => {
        const { wrapper, fetch } = await mountCategories({ "DELETE /api/categories/2/": [204] });
        const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
        await wrapper.findAll("li")[1].findAll("button")[1].trigger("click");
        await flushPromises();
        expect(confirm).toHaveBeenCalledWith("Delete the category Rent?");
        expect(fetch).toHaveBeenLastCalledWith("/api/categories/2/", expect.objectContaining({ method: "DELETE" }));
        expect(names(wrapper)).toEqual(["Groceries"]);
      });

      it("does nothing when the deletion is not confirmed", async () => {
        const { wrapper, fetch } = await mountCategories();
        vi.spyOn(window, "confirm").mockReturnValue(false);
        await wrapper.findAll("li")[1].findAll("button")[1].trigger("click");
        await flushPromises();
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(names(wrapper)).toEqual(["Groceries", "Rent"]);
      });

      it("shows an error when the deletion fails", async () => {
        const { wrapper } = await mountCategories({ "DELETE /api/categories/2/": [500, {}] });
        vi.spyOn(window, "confirm").mockReturnValue(true);
        await wrapper.findAll("li")[1].findAll("button")[1].trigger("click");
        await flushPromises();
        expect(wrapper.find("[role=alert]").text()).toBe("Unable to delete the category: try again later.");
        expect(names(wrapper)).toEqual(["Groceries", "Rent"]);
      });
    });
  });
});
