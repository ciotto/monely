import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { setLocale } from "@/i18n";

import { mockFetch, mountAt, page, USER } from "./helpers";

const WALLETS = [
  { id: 1, name: "Bank", currency: "EUR", owners: [1], is_archived: false },
  { id: 2, name: "Old card", currency: "USD", owners: [1], is_archived: true },
];
const CATEGORIES = [
  { id: 3, name: "Home", color: "#16a34a", icon: "house" },
  { id: 4, name: "Salary", color: "#2563eb", icon: "" },
];
const TAGS = [{ id: 5, name: "house", color: "#dc2626" }];
const RENT = {
  id: 7,
  wallet: 1,
  amount: "-800.00",
  description: "Rent",
  category: 3,
  tags: [5],
  notes: "Landlord",
  is_shared: false,
  frequency: "monthly",
  interval: 1,
  start_date: "2026-01-01",
  end_date: null,
  next_date: "2026-11-01",
  is_ended: false,
};
const SALARY = {
  ...RENT,
  id: 8,
  amount: "2500.00",
  description: "Salary",
  category: 4,
  tags: [],
  notes: "",
  frequency: "weekly",
  interval: 2,
  start_date: "2026-11-27",
  next_date: "2026-11-27",
};
const OLD = {
  ...RENT,
  id: 9,
  wallet: 2,
  amount: "-9.99",
  description: "Old subscription",
  category: null,
  tags: [],
  frequency: "yearly",
  end_date: "2025-12-31",
  next_date: "2026-01-01",
  is_ended: true,
};
const LOOKUPS = {
  "GET /api/auth/me/": [200, USER],
  "GET /api/wallets/": [200, WALLETS],
  "GET /api/categories/": [200, CATEGORIES],
  "GET /api/tags/": [200, TAGS],
};

// Mounted apps would otherwise keep reacting to the shared auth state of the next tests
enableAutoUnmount(afterEach);

describe("recurring transactions", () => {
  beforeEach(() => {
    setLocale("en");
    Object.assign(auth, { user: null, ready: false, setupRequired: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function submit(wrapper) {
    await wrapper.find("form").trigger("submit");
    await flushPromises();
  }

  function lastBody(fetch, url, method) {
    const [, options] = fetch.mock.calls.findLast(([callUrl, { method: callMethod }]) => {
      return callUrl === url && callMethod === method;
    });
    return JSON.parse(options.body);
  }

  describe("list", () => {
    const rows = (wrapper) => wrapper.findAll("tbody tr").map((row) => row.findAll("td").map((cell) => cell.text()));

    it("lists the recurring transactions from the settings menu", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/recurring-transactions/": [200, [RENT, SALARY, OLD]] });
      const { wrapper, router } = await mountAt("/");
      await wrapper.find("header button[name=menu]").trigger("click");
      await wrapper.find("header a[href='/recurring']").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("recurring");
      expect(wrapper.find("header button[name=menu]").classes()).toContain("text-brand");
      expect(wrapper.find("h1").text()).toBe("Recurring transactions");
      expect(rows(wrapper)).toEqual([
        ["Nov 1, 2026", "Renthouse", "Home", "Bank", "Every month", "-€800.00", "EditDelete"],
        ["Nov 27, 2026", "Salary", "Salary", "Bank", "Every 2 weeks", "+€2,500.00", "EditDelete"],
        ["Ended", "Old subscription", "", "Old card", "Every year", "-$9.99", "EditDelete"],
      ]);
      const amounts = wrapper.findAll("tbody tr").map((row) => row.findAll("td")[5].classes());
      expect(amounts[0]).toContain("text-expense");
      expect(amounts[1]).toContain("text-income");
      expect(amounts[2]).not.toContain("text-expense");
      expect(wrapper.findAll("tbody tr")[2].classes()).toContain("text-slate-400");
      expect(wrapper.find("tbody svg").exists()).toBe(true);
      expect(wrapper.find("[data-tag]").attributes("style")).toContain("background-color: rgb(220, 38, 38)");
      expect(wrapper.find("tbody tr a").attributes("href")).toBe("/recurring/7");
    });

    it("shows a loading message while fetching", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async (url) =>
          url === "/api/auth/me/" ? { ok: true, status: 200, json: async () => USER } : new Promise(() => {}),
        ),
      );
      const { wrapper } = await mountAt("/recurring");
      expect(wrapper.text()).toContain("Loading…");
    });

    it("shows a message when there are none", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/recurring-transactions/": [200, []] });
      const { wrapper } = await mountAt("/recurring");
      expect(wrapper.text()).toContain("No recurring transactions yet");
    });

    it("shows an error when they cannot be loaded", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/recurring-transactions/": [500, {}] });
      const { wrapper } = await mountAt("/recurring");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the recurring transactions: try again later.");
    });

    describe("deletion", () => {
      it("deletes a recurring transaction after confirmation", async () => {
        const confirm = vi.fn(() => true);
        vi.stubGlobal("confirm", confirm);
        const fetch = mockFetch({
          ...LOOKUPS,
          "GET /api/recurring-transactions/": [200, [RENT, SALARY]],
          "DELETE /api/recurring-transactions/7/": [204],
        });
        const { wrapper } = await mountAt("/recurring");
        await wrapper.find("tbody button").trigger("click");
        await flushPromises();
        expect(confirm).toHaveBeenCalledWith(
          "Delete the recurring transaction Rent? The transactions already registered are kept.",
        );
        expect(fetch).toHaveBeenLastCalledWith(
          "/api/recurring-transactions/7/",
          expect.objectContaining({ method: "DELETE" }),
        );
        expect(rows(wrapper).map((row) => row[1])).toEqual(["Salary"]);
      });

      it("keeps the recurring transaction when the confirmation is declined", async () => {
        vi.stubGlobal("confirm", () => false);
        const fetch = mockFetch({ ...LOOKUPS, "GET /api/recurring-transactions/": [200, [RENT]] });
        const { wrapper } = await mountAt("/recurring");
        const calls = fetch.mock.calls.length;
        await wrapper.find("tbody button").trigger("click");
        await flushPromises();
        expect(fetch.mock.calls.length).toBe(calls);
        expect(rows(wrapper)).toHaveLength(1);
      });

      it("shows an error when the deletion fails", async () => {
        vi.stubGlobal("confirm", () => true);
        mockFetch({
          ...LOOKUPS,
          "GET /api/recurring-transactions/": [200, [RENT]],
          "DELETE /api/recurring-transactions/7/": [500, {}],
        });
        const { wrapper } = await mountAt("/recurring");
        await wrapper.find("tbody button").trigger("click");
        await flushPromises();
        expect(wrapper.find("[role=alert]").text()).toBe(
          "Unable to delete the recurring transaction: try again later.",
        );
        expect(rows(wrapper)).toHaveLength(1);
      });
    });
  });

  describe("form", () => {
    it("creates a monthly expense on the only active wallet", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 10, 14, 10));
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/recurring-transactions/": [200, []],
        "POST /api/recurring-transactions/": [201, {}],
      });
      const { wrapper, router } = await mountAt("/recurring");
      await wrapper.find("a[href='/recurring/new']").trigger("click");
      await flushPromises();
      expect(wrapper.find("h1").text()).toBe("New recurring transaction");
      expect(wrapper.findAll("select[name=wallet] option").map((option) => option.text())).toEqual([
        "Choose a wallet",
        "Bank (EUR)",
      ]);
      expect(wrapper.find("select[name=wallet]").element.value).toBe("1");
      expect(wrapper.find("input[name=start_date]").element.value).toBe("2026-11-14");
      expect(wrapper.find("[data-next]").exists()).toBe(false);
      expect(wrapper.findAll("select[name=frequency] option").map((option) => option.text())).toEqual([
        "week",
        "month",
        "year",
      ]);

      await wrapper.find("input[name=amount]").setValue("800");
      await wrapper.find("input[name=description]").setValue("Rent");
      await wrapper.find("select[name=category]").setValue("3");
      await wrapper.find("input[name=tags]").setChecked(true);
      expect(wrapper.find("input[name=tags]").element.closest("label").classList).toContain("text-white");
      await wrapper.find("textarea[name=notes]").setValue("Landlord");
      await wrapper.find("input[name=is_shared]").setChecked(true);
      await submit(wrapper);
      expect(lastBody(fetch, "/api/recurring-transactions/", "POST")).toEqual({
        wallet: 1,
        description: "Rent",
        tags: [5],
        notes: "Landlord",
        is_shared: true,
        interval: 1,
        frequency: "monthly",
        start_date: "2026-11-14",
        amount: "-800",
        category: 3,
        end_date: null,
      });
      expect(router.currentRoute.value.name).toBe("recurring");
    });

    it("creates an income every few weeks until an end date", async () => {
      const wallets = [...WALLETS, { id: 10, name: "Cash", currency: "EUR", owners: [1], is_archived: false }];
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/wallets/": [200, wallets],
        "POST /api/recurring-transactions/": [201, {}],
      });
      const { wrapper } = await mountAt("/recurring/new");
      expect(wrapper.find("select[name=wallet]").element.value).toBe("");
      await wrapper.find("select[name=wallet]").setValue("10");
      await wrapper.find("input[name=kind][value=income]").setChecked(true);
      expect(wrapper.find("input[name=kind][value=income]").element.closest("label").classList).toContain(
        "text-income",
      );
      await wrapper.find("input[name=amount]").setValue("50");
      await wrapper.find("input[name=description]").setValue("Pocket money");
      await wrapper.find("input[name=interval]").setValue("2");
      await wrapper.find("select[name=frequency]").setValue("weekly");
      expect(wrapper.find("select[name=frequency] option").text()).toBe("weeks");
      // An empty interval still names the unit
      await wrapper.find("input[name=interval]").setValue("");
      expect(wrapper.find("select[name=frequency] option").text()).toBe("week");
      await wrapper.find("input[name=interval]").setValue("2");
      await wrapper.find("input[name=start_date]").setValue("2026-11-20");
      await wrapper.find("input[name=end_date]").setValue("2027-06-30");
      await submit(wrapper);
      expect(lastBody(fetch, "/api/recurring-transactions/", "POST")).toEqual({
        wallet: 10,
        description: "Pocket money",
        tags: [],
        notes: "",
        is_shared: false,
        interval: 2,
        frequency: "weekly",
        start_date: "2026-11-20",
        amount: "50",
        category: null,
        end_date: "2027-06-30",
      });
    });

    it("edits a recurring transaction of an archived wallet", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/recurring-transactions/9/": [200, { ...OLD, end_date: "2026-12-31", is_ended: false }],
        "PATCH /api/recurring-transactions/9/": [200, {}],
        "GET /api/recurring-transactions/": [200, []],
      });
      const { wrapper, router } = await mountAt("/recurring/9");
      expect(wrapper.find("h1").text()).toBe("Edit recurring transaction");
      expect(wrapper.find("select[name=wallet]").element.value).toBe("2");
      expect(wrapper.find("input[name=amount]").element.value).toBe("9.99");
      expect(wrapper.find("input[name=kind][value=expense]").element.checked).toBe(true);
      expect(wrapper.find("select[name=frequency]").element.value).toBe("yearly");
      expect(wrapper.find("input[name=end_date]").element.value).toBe("2026-12-31");
      expect(wrapper.find("[data-next]").text()).toBe("Next due date: Jan 1, 2026.");

      await wrapper.find("input[name=end_date]").setValue("");
      await submit(wrapper);
      expect(lastBody(fetch, "/api/recurring-transactions/9/", "PATCH")).toEqual({
        wallet: 2,
        description: "Old subscription",
        tags: [],
        notes: "Landlord",
        is_shared: false,
        interval: 1,
        frequency: "yearly",
        start_date: "2026-01-01",
        amount: "-9.99",
        category: null,
        end_date: null,
      });
      expect(router.currentRoute.value.name).toBe("recurring");
    });

    it("edits a recurring transaction without an end date", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/recurring-transactions/7/": [200, RENT],
        "PATCH /api/recurring-transactions/7/": [200, {}],
      });
      const { wrapper } = await mountAt("/recurring/7");
      expect(wrapper.find("input[name=end_date]").element.value).toBe("");
      expect(wrapper.find("select[name=category]").element.value).toBe("3");
      await submit(wrapper);
      expect(lastBody(fetch, "/api/recurring-transactions/7/", "PATCH").end_date).toBeNull();
    });

    it("edits an income, telling when it has ended", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/recurring-transactions/8/": [200, { ...SALARY, end_date: "2026-11-20", is_ended: true }],
        "PATCH /api/recurring-transactions/8/": [200, {}],
      });
      const { wrapper } = await mountAt("/recurring/8");
      expect(wrapper.find("input[name=kind][value=income]").element.checked).toBe(true);
      expect(wrapper.find("[data-next]").text()).toBe("There are no more occurrences: move the end date to resume it.");
      await submit(wrapper);
      expect(lastBody(fetch, "/api/recurring-transactions/8/", "PATCH").amount).toBe("2500.00");
    });

    it("shows the field errors returned by the backend", async () => {
      const errors = {
        wallet: ["This wallet is archived."],
        amount: ["The amount cannot be zero."],
        description: ["This field may not be blank."],
        interval: ["Ensure this value is greater than or equal to 1."],
        frequency: ['"daily" is not a valid choice.'],
        start_date: ["Date has wrong format."],
        end_date: ["The end date cannot precede the start date."],
        category: ["Invalid pk."],
        tags: ["Invalid tag."],
        notes: ["Invalid notes."],
      };
      mockFetch({ ...LOOKUPS, "POST /api/recurring-transactions/": [400, errors] });
      const { wrapper, router } = await mountAt("/recurring/new");
      await submit(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Check the fields below.");
      for (const messages of Object.values(errors)) {
        expect(wrapper.find("form").text()).toContain(messages[0]);
      }
      expect(wrapper.find("button[type=submit]").attributes("disabled")).toBeUndefined();
      expect(router.currentRoute.value.name).toBe("recurring-new");
    });

    it("shows a generic error when saving fails", async () => {
      mockFetch({ ...LOOKUPS, "POST /api/recurring-transactions/": [500, {}] });
      const { wrapper } = await mountAt("/recurring/new");
      await submit(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to save the recurring transaction: try again later.");
    });

    it("shows an error when the recurring transaction cannot be loaded", async () => {
      mockFetch(LOOKUPS);
      const { wrapper } = await mountAt("/recurring/99");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the recurring transaction.");
      expect(wrapper.find("form").exists()).toBe(false);
    });

    it("asks to create a wallet when there are no active wallets", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/wallets/": [200, WALLETS.slice(1)] });
      const { wrapper } = await mountAt("/recurring/new");
      expect(wrapper.text()).toContain("there are no active wallets");
      expect(wrapper.find("a[href='/wallets/new']").exists()).toBe(true);
    });

    it("explains when there are no tags", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/tags/": [200, []] });
      const { wrapper } = await mountAt("/recurring/new");
      expect(wrapper.text()).toContain("No tags yet.");
    });
  });

  describe("due", () => {
    const due = (wrapper) => wrapper.findAll("[data-due] li").map((item) => item.text());

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 10, 14, 10));
    });

    it("suggests the due occurrences in the transaction list", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/recurring-transactions/due/": [200, [RENT, SALARY]],
        "GET /api/transactions/": [200, page([])],
      });
      const { wrapper } = await mountAt("/transactions?wallet=1");
      expect(wrapper.find("[data-due] h2").text()).toBe("Due recurring transactions");
      expect(due(wrapper)).toEqual([
        "Nov 1, 2026Rent · Bank-€800.00RegisterSkip",
        "Nov 27, 2026Salary · Bank+€2,500.00RegisterSkip",
      ]);
      const dates = wrapper.findAll("[data-due] li > span:first-child");
      // The overdue ones stand out
      expect(dates[0].classes()).toContain("text-expense");
      expect(dates[1].classes()).not.toContain("text-expense");
      expect(wrapper.find("[data-due] li a").attributes("href")).toBe("/transactions/new?wallet=1&recurring=7");
    });

    it("hides the suggestions when nothing is due", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/recurring-transactions/due/": [200, []],
        "GET /api/transactions/": [200, page([])],
      });
      const { wrapper } = await mountAt("/transactions");
      expect(wrapper.find("[data-due]").exists()).toBe(false);
    });

    it("skips an occurrence and reloads the due ones", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/recurring-transactions/due/": [200, [RENT]],
        "GET /api/transactions/": [200, page([])],
      });
      const { wrapper } = await mountAt("/transactions");
      // The following occurrence is not due yet
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/recurring-transactions/due/": [200, []],
        "POST /api/recurring-transactions/7/skip/": [200, { ...RENT, next_date: "2026-12-01" }],
      });
      await wrapper.find("[data-due] button[name=skip]").trigger("click");
      await flushPromises();
      expect(fetch.mock.calls.map(([url, { method }]) => `${method} ${url}`)).toEqual([
        "POST /api/recurring-transactions/7/skip/",
        "GET /api/recurring-transactions/due/",
      ]);
      expect(wrapper.find("[data-due]").exists()).toBe(false);
    });

    it("shows an error when skipping fails", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/recurring-transactions/due/": [200, [RENT]],
        "GET /api/transactions/": [200, page([])],
        "POST /api/recurring-transactions/7/skip/": [400, ["This recurring transaction has ended."]],
      });
      const { wrapper } = await mountAt("/transactions");
      await wrapper.find("[data-due] button[name=skip]").trigger("click");
      await flushPromises();
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to skip the recurring transaction: try again later.");
      expect(due(wrapper)).toHaveLength(1);
    });

    it("registers an occurrence with the form filled in", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/recurring-transactions/due/": [200, [RENT]],
        "GET /api/transactions/": [200, page([])],
        "GET /api/recurring-transactions/7/": [200, RENT],
        "POST /api/transactions/": [201, {}],
      });
      const { wrapper, router } = await mountAt("/transactions?wallet=1");
      await wrapper.find("[data-due] li a").trigger("click");
      await flushPromises();
      expect(wrapper.find("h1").text()).toBe("New transaction");
      expect(wrapper.find("[data-recurring]").text()).toBe(
        "This transaction registers the recurring transaction due on Nov 1, 2026.",
      );
      expect(wrapper.find("input[name=date]").element.value).toBe("2026-11-01");
      expect(wrapper.find("input[name=amount]").element.value).toBe("800.00");
      // Going back keeps the filters, not the recurring transaction
      expect(wrapper.find("form a").attributes("href")).toBe("/transactions?wallet=1");

      await wrapper.find("input[name=amount]").setValue("810");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      const [, options] = fetch.mock.calls.findLast(([url, { method }]) => {
        return url === "/api/transactions/" && method === "POST";
      });
      expect(JSON.parse(options.body)).toEqual({
        wallet: 1,
        date: "2026-11-01",
        description: "Rent",
        tags: [5],
        notes: "Landlord",
        is_shared: false,
        amount: "-810",
        category: 3,
        recurring_transaction: 7,
      });
      expect(router.currentRoute.value.fullPath).toBe("/transactions?wallet=1");
    });

    it("links the registered transactions to their recurring transaction", async () => {
      const registered = { id: 4, wallet: 1, date: "2026-11-02", amount: "-800.00", description: "Rent", tags: [] };
      mockFetch({
        ...LOOKUPS,
        "GET /api/recurring-transactions/due/": [200, []],
        "GET /api/transactions/": [
          200,
          page([
            { ...registered, recurring_transaction: 7 },
            { ...registered, id: 3, recurring_transaction: null },
          ]),
        ],
      });
      const { wrapper } = await mountAt("/transactions");
      const links = wrapper.findAll("[data-recurring]");
      expect(links).toHaveLength(1);
      expect(links[0].attributes("href")).toBe("/recurring/7");
      expect(links[0].attributes("title")).toBe("Registered from a recurring transaction");
    });

    it("ignores the recurring transaction when editing a transaction", async () => {
      const transaction = { id: 4, wallet: 1, date: "2026-11-02", amount: "5.00", description: "Gift" };
      const fetch = mockFetch({ ...LOOKUPS, "GET /api/transactions/4/": [200, { ...transaction, tags: [] }] });
      const { wrapper } = await mountAt("/transactions/4?recurring=7");
      expect(wrapper.find("[data-recurring]").exists()).toBe(false);
      expect(fetch.mock.calls.map(([url]) => url)).not.toContain("/api/recurring-transactions/7/");
    });
  });
});
