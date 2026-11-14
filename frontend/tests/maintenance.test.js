import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { setLocale } from "@/i18n";

import { ADMIN, mockFetch, mountAt, USER } from "./helpers";

const COUNTS = {
  transactions: 120,
  transfers: 4,
  recurring_transactions: 5,
  wallets: 3,
  budgets: 6,
  categories: 12,
  tags: 2,
};
const EMPTY = Object.fromEntries(Object.keys(COUNTS).map((name) => [name, 0]));

// Mounted apps would otherwise keep reacting to the shared auth state of the next tests
enableAutoUnmount(afterEach);

describe("maintenance", () => {
  beforeEach(() => {
    setLocale("en");
    Object.assign(auth, { user: null, ready: false, setupRequired: false });
  });

  afterEach(() => vi.unstubAllGlobals());

  const counts = (wrapper) => wrapper.findAll("[data-counts] li").map((item) => item.text());
  const button = (wrapper) => wrapper.find("button[type=submit]");

  it("opens from the account menu of the admins", async () => {
    mockFetch({ "GET /api/auth/me/": [200, ADMIN], "GET /api/maintenance/data/": [200, COUNTS] });
    const { wrapper, router } = await mountAt("/");
    await wrapper.find("header button[name=menu]").trigger("click");
    await wrapper.find("header a[href='/maintenance']").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("maintenance");
    expect(wrapper.find("h1").text()).toBe("Maintenance");
    expect(counts(wrapper)).toEqual([
      "120transactions",
      "4transfers",
      "5recurring transactions",
      "3wallets",
      "6budgets",
      "12categories",
      "2tags",
    ]);
  });

  it("deletes all the data once confirmed", async () => {
    const fetch = mockFetch({
      "GET /api/auth/me/": [200, ADMIN],
      "GET /api/maintenance/data/": [200, COUNTS],
      "DELETE /api/maintenance/data/": [200, COUNTS],
    });
    const { wrapper } = await mountAt("/maintenance");
    expect(button(wrapper).attributes("disabled")).toBeDefined();
    await wrapper.find("input[name=confirmation]").setValue("delete");
    expect(button(wrapper).attributes("disabled")).toBeDefined();
    await wrapper.find("input[name=confirmation]").setValue(" DELETE ");
    expect(button(wrapper).attributes("disabled")).toBeUndefined();

    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(fetch).toHaveBeenLastCalledWith("/api/maintenance/data/", expect.objectContaining({ method: "DELETE" }));
    expect(wrapper.find("[role=status]").text()).toBe(
      "Deleted: 120 transactions, 4 transfers, 5 recurring transactions, 3 wallets, 6 budgets, 12 categories, 2 tags.",
    );
    expect(counts(wrapper)).toEqual([
      "0transactions",
      "0transfers",
      "0recurring transactions",
      "0wallets",
      "0budgets",
      "0categories",
      "0tags",
    ]);
    expect(wrapper.find("form").exists()).toBe(false);
    expect(wrapper.text()).toContain("There is no data to delete.");
  });

  it("asks for the confirmation word in the UI language", async () => {
    setLocale("it");
    mockFetch({ "GET /api/auth/me/": [200, ADMIN], "GET /api/maintenance/data/": [200, COUNTS] });
    const { wrapper } = await mountAt("/maintenance");
    expect(wrapper.find("label").text()).toBe("Per confermare, scrivi ELIMINA");
    await wrapper.find("input[name=confirmation]").setValue("DELETE");
    expect(button(wrapper).attributes("disabled")).toBeDefined();
    await wrapper.find("input[name=confirmation]").setValue("ELIMINA");
    expect(button(wrapper).attributes("disabled")).toBeUndefined();
  });

  it("disables the button while deleting", async () => {
    const fetch = mockFetch({ "GET /api/auth/me/": [200, ADMIN], "GET /api/maintenance/data/": [200, COUNTS] });
    const { wrapper } = await mountAt("/maintenance");
    fetch.mockImplementation(() => new Promise(() => {}));
    await wrapper.find("input[name=confirmation]").setValue("DELETE");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(button(wrapper).text()).toBe("Deleting…");
    expect(button(wrapper).attributes("disabled")).toBeDefined();
  });

  it("shows an error when the deletion fails", async () => {
    mockFetch({
      "GET /api/auth/me/": [200, ADMIN],
      "GET /api/maintenance/data/": [200, COUNTS],
      "DELETE /api/maintenance/data/": [500, {}],
    });
    const { wrapper } = await mountAt("/maintenance");
    await wrapper.find("input[name=confirmation]").setValue("DELETE");
    await wrapper.find("form").trigger("submit");
    await flushPromises();
    expect(wrapper.find("[role=alert]").text()).toBe("Unable to delete the data: try again later.");
    expect(counts(wrapper)[0]).toBe("120transactions");
    expect(button(wrapper).attributes("disabled")).toBeUndefined();
  });

  it("explains when there is no data", async () => {
    mockFetch({ "GET /api/auth/me/": [200, ADMIN], "GET /api/maintenance/data/": [200, EMPTY] });
    const { wrapper } = await mountAt("/maintenance");
    expect(wrapper.text()).toContain("There is no data to delete.");
    expect(wrapper.find("form").exists()).toBe(false);
  });

  it("shows a loading message while fetching", async () => {
    mockFetch({ "GET /api/auth/me/": [200, ADMIN] });
    fetch.mockImplementation(async (url) =>
      url === "/api/maintenance/data/" ? new Promise(() => {}) : { ok: true, status: 200, json: async () => ADMIN },
    );
    const { wrapper } = await mountAt("/maintenance");
    expect(wrapper.text()).toContain("Loading…");
  });

  it("shows an error when the data cannot be loaded", async () => {
    mockFetch({ "GET /api/auth/me/": [200, ADMIN], "GET /api/maintenance/data/": [500, {}] });
    const { wrapper } = await mountAt("/maintenance");
    expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the data: try again later.");
  });

  it("is not reachable by non admin users", async () => {
    mockFetch({ "GET /api/auth/me/": [200, USER] });
    const { router } = await mountAt("/maintenance");
    expect(router.currentRoute.value.name).toBe("dashboard");
  });
});
