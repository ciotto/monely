import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { setLocale } from "@/i18n";

import { mockFetch, mountAt, USER } from "./helpers";

const WALLETS = [
  { id: 1, name: "Bank", currency: "EUR", owners: [1], is_archived: false, is_shared: false },
  { id: 2, name: "Card", currency: "USD", owners: [1], is_archived: false, is_shared: false },
];
const BALANCE = { month: "2026-11", currencies: [] };
const EUR = { id: 5, currency: "EUR", amount: "2000.00", start_month: "2026-10" };

// Mounted apps would otherwise keep reacting to the shared auth state of the next tests
enableAutoUnmount(afterEach);

describe("family contributions", () => {
  beforeEach(() => {
    setLocale("en");
    Object.assign(auth, { user: null, ready: false, setupRequired: false });
    vi.useFakeTimers({ toFake: ["Date"], now: new Date(2026, 10, 14) });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function lastBody(fetch, url, method) {
    const [, options] = fetch.mock.calls.findLast(([callUrl, { method: m }]) => callUrl === url && m === method);
    return JSON.parse(options.body);
  }

  it("adds a contribution in the family balance, from the settings menu", async () => {
    const fetch = mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, BALANCE],
      "GET /api/family-balance/?month=2026-11": [200, BALANCE],
      "GET /api/wallets/": [200, WALLETS],
      "GET /api/contributions/": [200, []],
      "POST /api/contributions/": [201, {}],
    });
    const { wrapper } = await mountAt("/");
    await wrapper.find("header button").trigger("click");
    await wrapper.find("a[href='/family']").trigger("click");
    await flushPromises();
    expect(wrapper.find("h1").text()).toBe("Family balance");
    expect(wrapper.find("h2").text()).toBe("Family contributions");
    expect(wrapper.text()).toContain("No contributions yet");
    expect(wrapper.findAll("select[name=currency] option").map((option) => option.text())).toEqual(["EUR", "USD"]);
    expect(wrapper.find("input[name=start_month]").element.value).toBe("2026-11");

    await wrapper.find("select[name=currency]").setValue("USD");
    await wrapper.find("input[name=amount]").setValue("1500");
    await wrapper.find("input[name=start_month]").setValue("2026-10");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(lastBody(fetch, "/api/contributions/", "POST")).toEqual({
      currency: "USD",
      amount: "1500",
      start_month: "2026-10",
    });
    // The form starts again, and the balance includes the new contribution
    expect(wrapper.find("input[name=amount]").element.value).toBe("");
    expect(fetch).toHaveBeenLastCalledWith("/api/family-balance/?month=2026-11", expect.anything());
  });

  it("uses EUR without wallets", async () => {
    mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, BALANCE],
      "GET /api/wallets/": [200, []],
      "GET /api/contributions/": [200, []],
    });
    const { wrapper } = await mountAt("/family");
    // A single currency needs no choice
    expect(wrapper.find("select[name=currency]").exists()).toBe(false);
  });

  it("shows the errors of a new contribution", async () => {
    mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, BALANCE],
      "GET /api/wallets/": [200, WALLETS],
      "GET /api/contributions/": [200, [EUR]],
      "POST /api/contributions/": [400, { currency: ["This currency already has a family contribution."] }],
    });
    const { wrapper } = await mountAt("/family");
    await wrapper.find("input[name=amount]").setValue("10");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find("form").text()).toContain("This currency already has a family contribution.");
  });

  it("edits a contribution", async () => {
    const fetch = mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, BALANCE],
      "GET /api/wallets/": [200, WALLETS],
      "GET /api/contributions/": [200, [EUR]],
      "PATCH /api/contributions/5/": [200, EUR],
    });
    const { wrapper } = await mountAt("/family");
    expect(wrapper.find("[data-summary]").text()).toBe("€2,000.00 a month since October 2026");

    await wrapper.find("[data-contribution] button").trigger("click");
    expect(wrapper.find("input[name=edit_amount]").element.value).toBe("2000");
    expect(wrapper.find("input[name=edit_start_month]").element.value).toBe("2026-10");
    // Cancelling keeps the contribution
    await wrapper.findAll("[data-contribution] button")[1].trigger("click");
    expect(wrapper.find("input[name=edit_amount]").exists()).toBe(false);

    await wrapper.find("[data-contribution] button").trigger("click");
    await wrapper.find("input[name=edit_amount]").setValue("2500");
    await wrapper.find("input[name=edit_start_month]").setValue("2026-09");
    await wrapper.find("[data-contribution] form").trigger("submit");
    await flushPromises();
    expect(lastBody(fetch, "/api/contributions/5/", "PATCH")).toEqual({ amount: "2500", start_month: "2026-09" });
    expect(wrapper.find("input[name=edit_amount]").exists()).toBe(false);
  });

  it("shows the errors of an edited contribution", async () => {
    mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, BALANCE],
      "GET /api/wallets/": [200, WALLETS],
      "GET /api/contributions/": [200, [EUR]],
      "PATCH /api/contributions/5/": [400, { amount: ["Ensure this value is greater than or equal to 0."] }],
    });
    const { wrapper } = await mountAt("/family");
    await wrapper.find("[data-contribution] button").trigger("click");
    await wrapper.find("[data-contribution] form").trigger("submit");
    await flushPromises();
    expect(wrapper.find("[data-contribution]").text()).toContain("greater than or equal to 0");
    expect(wrapper.find("input[name=edit_amount]").exists()).toBe(true);
  });

  it("deletes a contribution after confirming", async () => {
    const fetch = mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, BALANCE],
      "GET /api/wallets/": [200, WALLETS],
      "GET /api/contributions/": [200, [EUR]],
      "DELETE /api/contributions/5/": [204],
    });
    const confirm = vi.fn(() => false);
    vi.stubGlobal("confirm", confirm);
    const { wrapper } = await mountAt("/family");
    const remove = wrapper.findAll("[data-contribution] button")[1];
    await remove.trigger("click");
    expect(confirm).toHaveBeenCalledWith("Delete the family contribution in EUR?");
    expect(fetch.mock.calls.some(([, { method }]) => method === "DELETE")).toBe(false);

    confirm.mockReturnValue(true);
    await remove.trigger("click");
    await flushPromises();
    expect(fetch).toHaveBeenCalledWith("/api/contributions/5/", expect.objectContaining({ method: "DELETE" }));
  });

  it("shows an error when saving fails", async () => {
    mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, BALANCE],
      "GET /api/wallets/": [200, WALLETS],
      "GET /api/contributions/": [200, [EUR]],
      "DELETE /api/contributions/5/": [500, {}],
    });
    vi.stubGlobal("confirm", () => true);
    const { wrapper } = await mountAt("/family");
    await wrapper.findAll("[data-contribution] button")[1].trigger("click");
    await flushPromises();
    expect(wrapper.find("[role=alert]").text()).toBe("Could not save the family contribution.");
  });

  it("shows an error when the contributions cannot be loaded", async () => {
    mockFetch({
      "GET /api/auth/me/": [200, USER],
      "GET /api/family-balance/": [200, BALANCE],
      "GET /api/wallets/": [500, {}],
    });
    const { wrapper } = await mountAt("/family");
    expect(wrapper.find("[role=alert]").text()).toBe("Could not load the family contributions.");
    expect(wrapper.find("form").exists()).toBe(false);
  });
});
