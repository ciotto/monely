import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { setLocale } from "@/i18n";

import { mockFetch, mountAt, USER } from "./helpers";

const WALLETS = [{ id: 1, name: "Bank", currency: "EUR", owners: [1], is_archived: false }];
const CATEGORIES = [
  { id: 3, name: "Car", color: "#7c3aed", icon: "car" },
  { id: 4, name: "Groceries", color: "#16a34a", icon: "" },
];
const CAR = {
  id: 10,
  category: 3,
  currency: "EUR",
  amount: "150.00",
  transactions: "30.00",
  recurring: "100.00",
  spent: "130.00",
  remaining: "20.00",
  recurring_transactions: [{ id: 7, description: "Insurance", share: "100.00" }],
};
const GROCERIES = {
  id: 11,
  category: 4,
  currency: "EUR",
  amount: "300.00",
  transactions: "320.50",
  recurring: "0.00",
  spent: "320.50",
  remaining: "-20.50",
  recurring_transactions: [],
};
const SUMMARY = { month: "2026-11", budgets: [CAR, GROCERIES] };
const LOOKUPS = {
  "GET /api/auth/me/": [200, USER],
  "GET /api/wallets/": [200, WALLETS],
  "GET /api/categories/": [200, CATEGORIES],
};

// Mounted apps would otherwise keep reacting to the shared auth state of the next tests
enableAutoUnmount(afterEach);

describe("budgets", () => {
  beforeEach(() => {
    setLocale("en");
    Object.assign(auth, { user: null, ready: false, setupRequired: false });
  });

  afterEach(() => vi.unstubAllGlobals());

  const budgets = (wrapper) =>
    wrapper.findAll("[data-budget]").map((item) => ({
      name: item.find("[data-name]").text(),
      spent: item.find("[data-spent]").text(),
      breakdown: item.find("[data-breakdown]").text(),
      remaining: item.find("[data-remaining]").text(),
      progress: item.find("[role=progressbar]").attributes("aria-valuenow"),
      recurring: item.findAll("[data-recurring] li").map((row) => row.text()),
    }));

  function lastBody(fetch, url, method) {
    const [, options] = fetch.mock.calls.findLast(([callUrl, { method: callMethod }]) => {
      return callUrl === url && callMethod === method;
    });
    return JSON.parse(options.body);
  }

  it("shows the budgets of the current month from the navigation bar", async () => {
    const fetch = mockFetch({ ...LOOKUPS, "GET /api/budgets/summary/": [200, SUMMARY] });
    const { wrapper, router } = await mountAt("/");
    await wrapper.find("header nav a[href='/budgets']").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("budgets");
    expect(fetch).toHaveBeenCalledWith("/api/budgets/summary/", expect.anything());
    expect(wrapper.find("h1").text()).toBe("Budget");
    expect(wrapper.find("input[name=month]").element.value).toBe("2026-11");
    expect(budgets(wrapper)).toEqual([
      {
        name: "Car",
        spent: "€130.00 of €150.00",
        breakdown: "Transactions €30.00 · Recurring €100.00",
        remaining: "€20.00 left",
        progress: "87",
        recurring: ["Insurance€100.00/month"],
      },
      {
        name: "Groceries",
        spent: "€320.50 of €300.00",
        breakdown: "Transactions €320.50 · Recurring €0.00",
        remaining: "€20.50 over budget",
        progress: "100",
        recurring: [],
      },
    ]);
    const bars = wrapper.findAll("[role=progressbar] div");
    expect(bars[0].classes()).toContain("bg-brand");
    expect(bars[1].classes()).toContain("bg-expense");
    expect(wrapper.findAll("[data-remaining]")[1].classes()).toContain("text-expense");
    // The icon of the category, or its color
    expect(wrapper.find("[data-budget] svg").exists()).toBe(true);
    // A single currency is not shown
    expect(wrapper.find("select[name=currency]").exists()).toBe(false);
  });

  it("does not go below zero when the refunds exceed the expenses", async () => {
    const refunded = { ...CAR, spent: "-5.00", transactions: "-5.00", recurring: "0.00", remaining: "155.00" };
    mockFetch({ ...LOOKUPS, "GET /api/budgets/summary/": [200, { ...SUMMARY, budgets: [refunded] }] });
    const { wrapper } = await mountAt("/budgets");
    expect(wrapper.find("[role=progressbar]").attributes("aria-valuenow")).toBe("0");
  });

  it("moves between the months", async () => {
    const fetch = mockFetch({
      ...LOOKUPS,
      "GET /api/budgets/summary/": [200, SUMMARY],
      "GET /api/budgets/summary/?month=2026-10": [200, { ...SUMMARY, month: "2026-10" }],
      "GET /api/budgets/summary/?month=2026-12": [200, { ...SUMMARY, month: "2026-12" }],
      "GET /api/budgets/summary/?month=2027-03": [200, { ...SUMMARY, month: "2027-03" }],
    });
    const { wrapper } = await mountAt("/budgets");
    await wrapper.find("button[name=previous]").trigger("click");
    await flushPromises();
    expect(fetch).toHaveBeenLastCalledWith("/api/budgets/summary/?month=2026-10", expect.anything());
    await wrapper.find("button[name=next]").trigger("click");
    await wrapper.find("button[name=next]").trigger("click");
    await flushPromises();
    expect(wrapper.find("input[name=month]").element.value).toBe("2026-12");
    await wrapper.find("input[name=month]").setValue("2027-03");
    await flushPromises();
    expect(fetch).toHaveBeenLastCalledWith("/api/budgets/summary/?month=2027-03", expect.anything());
    // Clearing the field keeps the month
    const calls = fetch.mock.calls.length;
    await wrapper.find("input[name=month]").setValue("");
    expect(fetch.mock.calls.length).toBe(calls);
  });

  it("shows a loading message while fetching", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url) =>
        url === "/api/auth/me/" ? { ok: true, status: 200, json: async () => USER } : new Promise(() => {}),
      ),
    );
    const { wrapper } = await mountAt("/budgets");
    expect(wrapper.text()).toContain("Loading…");
  });

  it("shows a message when there are none", async () => {
    mockFetch({ ...LOOKUPS, "GET /api/budgets/summary/": [200, { month: "2026-11", budgets: [] }] });
    const { wrapper } = await mountAt("/budgets");
    expect(wrapper.text()).toContain("No budgets yet");
  });

  it("shows an error when the lookups cannot be loaded", async () => {
    mockFetch({ ...LOOKUPS, "GET /api/categories/": [500, {}] });
    const { wrapper } = await mountAt("/budgets");
    expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the budgets: try again later.");
  });

  it("shows an error when the month cannot be loaded", async () => {
    mockFetch({ ...LOOKUPS, "GET /api/budgets/summary/": [500, {}] });
    const { wrapper } = await mountAt("/budgets");
    expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the budgets: try again later.");
  });

  describe("create", () => {
    it("adds a budget and reloads the month", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/budgets/summary/": [200, { month: "2026-11", budgets: [] }],
        "GET /api/budgets/summary/?month=2026-11": [200, SUMMARY],
        "POST /api/budgets/": [201, { id: 10, category: 3, currency: "EUR", amount: "150.00" }],
      });
      const { wrapper } = await mountAt("/budgets");
      await wrapper.find("select[name=category]").setValue(3);
      await wrapper.find("input[name=amount]").setValue("150");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      expect(lastBody(fetch, "/api/budgets/", "POST")).toEqual({ category: 3, currency: "EUR", amount: 150 });
      expect(budgets(wrapper).map((item) => item.name)).toEqual(["Car", "Groceries"]);
      expect(wrapper.find("select[name=category]").element.value).toBe("");
    });

    it("chooses the currency when the wallets use more than one", async () => {
      const wallets = [...WALLETS, { id: 2, name: "US account", currency: "USD", owners: [1], is_archived: false }];
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/wallets/": [200, wallets],
        "GET /api/budgets/summary/": [200, SUMMARY],
        "GET /api/budgets/summary/?month=2026-11": [200, SUMMARY],
        "POST /api/budgets/": [201, {}],
      });
      const { wrapper } = await mountAt("/budgets");
      expect(wrapper.findAll("select[name=currency] option").map((option) => option.text())).toEqual(["EUR", "USD"]);
      expect(wrapper.find("[data-budget]").text()).toContain("EUR");
      await wrapper.find("select[name=category]").setValue(4);
      await wrapper.find("select[name=currency]").setValue("USD");
      await wrapper.find("input[name=amount]").setValue("50");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      expect(lastBody(fetch, "/api/budgets/", "POST")).toEqual({ category: 4, currency: "USD", amount: 50 });
    });

    it("defaults to euros without wallets", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/wallets/": [200, []],
        "GET /api/budgets/summary/": [200, SUMMARY],
        "POST /api/budgets/": [500, {}],
      });
      const { wrapper } = await mountAt("/budgets");
      await wrapper.find("select[name=category]").setValue(4);
      await wrapper.find("input[name=amount]").setValue("50");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      expect(lastBody(fetch, "/api/budgets/", "POST").currency).toBe("EUR");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to save the budget: try again later.");
    });

    it("shows the errors of the backend", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/budgets/summary/": [200, SUMMARY],
        "POST /api/budgets/": [400, { category: ["This category already has a budget in this currency."] }],
      });
      const { wrapper } = await mountAt("/budgets");
      await wrapper.find("select[name=category]").setValue(3);
      await wrapper.find("input[name=amount]").setValue("10");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      expect(wrapper.find("form").text()).toContain("This category already has a budget in this currency.");
      // The draft is kept, to fix it
      expect(wrapper.find("input[name=amount]").element.value).toBe("10");
    });
  });

  describe("edit", () => {
    it("changes the amount", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/budgets/summary/": [200, SUMMARY],
        "GET /api/budgets/summary/?month=2026-11": [200, SUMMARY],
        "PATCH /api/budgets/10/": [200, { ...CAR, amount: "200.00" }],
      });
      const { wrapper } = await mountAt("/budgets");
      await wrapper
        .findAll("[data-budget] button")
        .find((button) => button.text() === "Edit")
        .trigger("click");
      const input = wrapper.find("input[name=edit_amount]");
      expect(input.element.value).toBe("150");
      await input.setValue("200");
      await wrapper.find("[data-budget] form").trigger("submit");
      await flushPromises();
      expect(lastBody(fetch, "/api/budgets/10/", "PATCH")).toEqual({ amount: 200 });
      expect(wrapper.find("input[name=edit_amount]").exists()).toBe(false);
    });

    it("shows the errors of the backend", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/budgets/summary/": [200, SUMMARY],
        "PATCH /api/budgets/10/": [400, { amount: ["Ensure this value is greater than or equal to 0.01."] }],
      });
      const { wrapper } = await mountAt("/budgets");
      await wrapper
        .findAll("[data-budget] button")
        .find((button) => button.text() === "Edit")
        .trigger("click");
      await wrapper.find("[data-budget] form").trigger("submit");
      await flushPromises();
      expect(wrapper.find("[data-budget]").text()).toContain("Ensure this value is greater than or equal to 0.01.");
      expect(wrapper.find("input[name=edit_amount]").exists()).toBe(true);
    });

    it("can be cancelled", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/budgets/summary/": [200, SUMMARY] });
      const { wrapper } = await mountAt("/budgets");
      await wrapper
        .findAll("[data-budget] button")
        .find((button) => button.text() === "Edit")
        .trigger("click");
      await wrapper
        .findAll("[data-budget] button")
        .find((button) => button.text() === "Cancel")
        .trigger("click");
      expect(wrapper.find("input[name=edit_amount]").exists()).toBe(false);
    });
  });

  describe("delete", () => {
    const deleteButton = (wrapper) =>
      wrapper.findAll("[data-budget] button").find((button) => button.text() === "Delete");

    it("deletes a budget once confirmed", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/budgets/summary/": [200, SUMMARY],
        "GET /api/budgets/summary/?month=2026-11": [200, { ...SUMMARY, budgets: [GROCERIES] }],
        "DELETE /api/budgets/10/": [204, undefined],
      });
      const confirm = vi.fn(() => true);
      vi.stubGlobal("confirm", confirm);
      const { wrapper } = await mountAt("/budgets");
      await deleteButton(wrapper).trigger("click");
      await flushPromises();
      expect(confirm).toHaveBeenCalledWith("Delete the budget of Car? The category and its transactions are kept.");
      expect(fetch).toHaveBeenCalledWith("/api/budgets/10/", expect.objectContaining({ method: "DELETE" }));
      expect(budgets(wrapper).map((item) => item.name)).toEqual(["Groceries"]);
    });

    it("does nothing when not confirmed", async () => {
      const fetch = mockFetch({ ...LOOKUPS, "GET /api/budgets/summary/": [200, SUMMARY] });
      vi.stubGlobal(
        "confirm",
        vi.fn(() => false),
      );
      const { wrapper } = await mountAt("/budgets");
      await deleteButton(wrapper).trigger("click");
      await flushPromises();
      expect(fetch).not.toHaveBeenCalledWith("/api/budgets/10/", expect.anything());
    });

    it("shows an error when the budget cannot be deleted", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/budgets/summary/": [200, SUMMARY], "DELETE /api/budgets/10/": [500, {}] });
      vi.stubGlobal(
        "confirm",
        vi.fn(() => true),
      );
      const { wrapper } = await mountAt("/budgets");
      await deleteButton(wrapper).trigger("click");
      await flushPromises();
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to delete the budget: try again later.");
      expect(budgets(wrapper)).toHaveLength(2);
    });
  });
});
