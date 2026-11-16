import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { setLocale } from "@/i18n";

import { mockFetch, mountAt, USER } from "./helpers";

const ANNA = { id: 1, email: "anna@example.com", first_name: "Anna", last_name: "Bianchi" };
const LUCA = { id: 2, email: "luca@example.com", first_name: "", last_name: "" };
const EUR = {
  id: 5,
  currency: "EUR",
  amount: "2000.00",
  start_month: "2026-10",
  months: 2,
  due: "2000.00",
  level: "2000.00",
  wallets: [{ id: 3, name: "Joint" }],
  members: [
    { ...ANNA, transfers: "1000.00", shared_expenses: "250.00", paid: "1250.00", suggested: "750.00", wallets: [1] },
    { ...LUCA, transfers: "2000.00", shared_expenses: "0.00", paid: "2000.00", suggested: "0.00", wallets: [] },
  ],
};
const BALANCE = { month: "2026-11", currencies: [EUR] };
const WALLETS = [
  { id: 1, name: "Bank", currency: "EUR", owners: [1], is_archived: false, is_shared: false },
  { id: 3, name: "Joint", currency: "EUR", owners: [], is_archived: false, is_shared: true },
];

// Mounted apps would otherwise keep reacting to the shared auth state of the next tests
enableAutoUnmount(afterEach);

describe("family balance", () => {
  beforeEach(() => {
    setLocale("en");
    Object.assign(auth, { user: null, ready: false, setupRequired: false });
  });

  afterEach(() => vi.unstubAllGlobals());

  const members = (wrapper) =>
    wrapper.findAll("[data-member]").map((row) => row.findAll("td").map((cell) => cell.text()));

  it("shows how much each member has to transfer", async () => {
    const fetch = mockFetch({ "GET /api/auth/me/": [200, USER], "GET /api/family-balance/": [200, BALANCE] });
    const { wrapper } = await mountAt("/family");
    expect(wrapper.find("h1").text()).toBe("Family balance");
    expect(fetch).toHaveBeenCalledWith("/api/family-balance/", expect.anything());
    expect(wrapper.find("input[name=month]").element.value).toBe("2026-11");
    expect(wrapper.find("h2").text()).toBe("EUR");
    expect(wrapper.find("[data-summary]").text()).toBe(
      "€2,000.00 a month since October 2026: each member is due €2,000.00, the level to reach is €2,000.00.",
    );
    expect(wrapper.find("[data-wallets]").text()).toBe("Joint wallets: Joint.");
    expect(members(wrapper)).toEqual([
      ["Anna Bianchi", "€1,000.00", "€250.00", "€1,250.00", "€750.00", "Register transfer"],
      ["luca@example.com", "€2,000.00", "€0.00", "€2,000.00", "€0.00", ""],
    ]);
    const suggested = wrapper.findAll("[data-suggested]");
    expect(suggested[0].classes()).toContain("text-expense");
    expect(suggested[1].classes()).toContain("text-income");
  });

  it("registers the suggested transfer to the joint wallet", async () => {
    const fetch = mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, BALANCE],
      "GET /api/wallets/": [200, WALLETS],
      "POST /api/transfers/": [201, {}],
      "GET /api/transactions/": [200, { count: 0, next: null, previous: null, results: [] }],
      "GET /api/categories/": [200, []],
      "GET /api/tags/": [200, []],
      "GET /api/recurring-transactions/due/": [200, []],
    });
    const { wrapper, router } = await mountAt("/family");
    await wrapper.find("[data-transfer]").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.fullPath).toBe("/transfers/new?amount=750.00&from_wallet=1&to_wallet=3");
    expect(wrapper.find("select[name=to_wallet]").element.value).toBe("3");
    expect(wrapper.find("input[name=amount]").element.value).toBe("750.00");

    // The only personal wallet of the member
    expect(wrapper.find("select[name=from_wallet]").element.value).toBe("1");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    const [, { body }] = fetch.mock.calls.find(([url, { method }]) => url === "/api/transfers/" && method === "POST");
    expect(JSON.parse(body)).toMatchObject({ from_wallet: 1, to_wallet: 3, amount: "750.00" });
    // The prefilled values do not end up in the filters of the list
    expect(router.currentRoute.value.fullPath).toBe("/transactions");
  });

  it("suggests the transfers still due in the transaction list", async () => {
    const usd = {
      ...EUR,
      id: 6,
      currency: "USD",
      wallets: [],
      members: [{ ...LUCA, suggested: "20.00", wallets: [7, 8] }],
    };
    mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, { ...BALANCE, currencies: [EUR, usd] }],
      "GET /api/wallets/": [200, WALLETS],
      "GET /api/categories/": [200, []],
      "GET /api/tags/": [200, []],
      "GET /api/recurring-transactions/due/": [200, []],
      "GET /api/transactions/?wallet=1": [200, { count: 0, next: null, previous: null, results: [] }],
    });
    const { wrapper } = await mountAt("/transactions?wallet=1");
    expect(wrapper.find("[data-family] h2").text()).toBe("Family transfers");
    // Only who still has to transfer something
    const rows = wrapper.findAll("[data-family] li");
    expect(rows.map((row) => row.text())).toEqual([
      "Anna Bianchi€750.00Register transfer",
      "luca@example.com$20.00Register transfer",
    ]);
    // Back to the same list after registering it
    expect(rows[0].find("a").attributes("href")).toBe(
      "/transfers/new?wallet=1&amount=750.00&from_wallet=1&to_wallet=3",
    );
    expect(rows[1].find("a").attributes("href")).toBe("/transfers/new?wallet=1&amount=20.00");
  });

  it("hides the family transfers when nothing is due or the balance is not available", async () => {
    const lookups = {
      "GET /api/auth/me/": [200, USER],
      "GET /api/wallets/": [200, WALLETS],
      "GET /api/categories/": [200, []],
      "GET /api/tags/": [200, []],
      "GET /api/recurring-transactions/due/": [200, []],
      "GET /api/transactions/": [200, { count: 0, next: null, previous: null, results: [] }],
    };
    const paid = { ...EUR, members: EUR.members.map((member) => ({ ...member, suggested: "0.00" })) };
    mockFetch({ ...lookups, "GET /api/family-balance/": [200, { ...BALANCE, currencies: [paid] }] });
    let { wrapper } = await mountAt("/transactions");
    expect(wrapper.find("[data-family]").exists()).toBe(false);

    mockFetch({ ...lookups, "GET /api/family-balance/": [500, {}] });
    ({ wrapper } = await mountAt("/transactions"));
    expect(wrapper.find("[data-family]").exists()).toBe(false);
    // The list works anyway
    expect(wrapper.find("[role=alert]").exists()).toBe(false);
  });

  it("moves between the months", async () => {
    const fetch = mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/?month=2026-09": [200, { ...BALANCE, month: "2026-09" }],
      "GET /api/family-balance/?month=2026-08": [200, { ...BALANCE, month: "2026-08" }],
      "GET /api/family-balance/?month=2026-10": [200, { ...BALANCE, month: "2026-10" }],
      "GET /api/family-balance/?month=2027-01": [200, { ...BALANCE, month: "2027-01" }],
    });
    const { wrapper } = await mountAt("/family?month=2026-09");
    expect(wrapper.find("input[name=month]").element.value).toBe("2026-09");

    await wrapper.find("button[name=previous]").trigger("click");
    await flushPromises();
    expect(wrapper.find("input[name=month]").element.value).toBe("2026-08");
    await wrapper.find("button[name=next]").trigger("click");
    await wrapper.find("button[name=next]").trigger("click");
    await flushPromises();
    expect(wrapper.find("input[name=month]").element.value).toBe("2026-10");

    const input = wrapper.find("input[name=month]");
    await input.setValue("2027-01");
    await flushPromises();
    expect(fetch).toHaveBeenLastCalledWith("/api/family-balance/?month=2027-01", expect.anything());
    // Clearing the field keeps the month
    const calls = fetch.mock.calls.length;
    await input.setValue("");
    await flushPromises();
    expect(fetch.mock.calls).toHaveLength(calls);
  });

  it("explains how to start without contributions", async () => {
    mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, { month: "2026-11", currencies: [] }],
    });
    const { wrapper } = await mountAt("/family");
    expect(wrapper.text()).toContain("No family contribution yet: set below how much");
  });

  it("lets choose the joint wallet when there are many, or none", async () => {
    const many = { ...EUR, wallets: [...EUR.wallets, { id: 4, name: "Holiday" }] };
    const none = { ...EUR, id: 6, currency: "USD", wallets: [] };
    mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, { month: "2026-11", currencies: [many, none] }],
    });
    const { wrapper } = await mountAt("/family");
    const [eur, usd] = wrapper.findAll("[data-currency]");
    expect(eur.find("[data-wallets]").text()).toBe("Joint wallets: Joint, Holiday.");
    expect(eur.find("[data-transfer]").attributes("href")).toBe("/transfers/new?amount=750.00&from_wallet=1");
    expect(usd.find("[data-wallets]").text()).toBe(
      "No joint wallet in this currency: mark one as joint in its settings.",
    );
  });

  it("shows an error when the balance cannot be loaded", async () => {
    mockFetch({ "GET /api/auth/me/": [200, USER], "GET /api/family-balance/": [500, {}] });
    const { wrapper } = await mountAt("/family");
    expect(wrapper.find("[role=alert]").text()).toBe("Could not load the family balance.");
    expect(wrapper.find("input[name=month]").exists()).toBe(false);
  });
});
