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
  { id: 3, name: "Groceries", color: "#16a34a", icon: "shopping-cart" },
  { id: 4, name: "Salary", color: "#2563eb", icon: "" },
];
const TAGS = [
  { id: 5, name: "car", color: "#dc2626" },
  { id: 6, name: "holiday-2026", color: "#7c3aed" },
];
const TRANSACTIONS = [
  {
    id: 7,
    wallet: 1,
    date: "2026-11-12",
    amount: "-42.30",
    description: "Supermarket",
    category: 3,
    tags: [5, 6],
    notes: "Weekly shopping",
  },
  { id: 8, wallet: 1, date: "2026-11-05", amount: "1500.00", description: "Pay", category: 4, tags: [], notes: "" },
  { id: 9, wallet: 2, date: "2026-10-31", amount: "-9.99", description: "Old", category: null, tags: [], notes: "" },
];
// The requests every transaction page makes
const LOOKUPS = {
  "GET /api/auth/me/": [200, USER],
  "GET /api/wallets/": [200, WALLETS],
  "GET /api/categories/": [200, CATEGORIES],
  "GET /api/tags/": [200, TAGS],
  "GET /api/recurring-transactions/due/": [200, []],
};

// Mounted apps would otherwise keep reacting to the shared auth state of the next tests
enableAutoUnmount(afterEach);

describe("transactions", () => {
  beforeEach(() => {
    setLocale("en");
    Object.assign(auth, { user: null, ready: false, setupRequired: false });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("list", () => {
    const rows = (wrapper) => wrapper.findAll("tbody tr").map((row) => row.findAll("td").map((cell) => cell.text()));

    it("lists the transactions from the header link", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, page(TRANSACTIONS)] });
      const { wrapper, router } = await mountAt("/");
      await wrapper.find("header a[href='/transactions']").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.name).toBe("transactions");
      expect(wrapper.find("h1").text()).toBe("Transactions");
      expect(rows(wrapper)).toEqual([
        ["Nov 12, 2026", "Supermarketcarholiday-2026", "Groceries", "Bank", "-€42.30", "EditDelete"],
        ["Nov 5, 2026", "Pay", "Salary", "Bank", "+€1,500.00", "EditDelete"],
        ["Oct 31, 2026", "Old", "", "Old card", "-$9.99", "EditDelete"],
      ]);
      const cells = wrapper.findAll("tbody tr")[0].findAll("td");
      expect(cells[1].find("[title]").attributes("title")).toBe("Weekly shopping");
      expect(cells[1].findAll("[data-tag]").map((tag) => tag.attributes("style"))).toEqual([
        "background-color: rgb(220, 38, 38);",
        "background-color: rgb(124, 58, 237);",
      ]);
      expect(cells[2].find("svg").exists()).toBe(true);
      expect(cells[4].classes()).toContain("text-expense");
      expect(wrapper.findAll("tbody tr")[1].findAll("td")[4].classes()).toContain("text-income");
    });

    it("formats dates and amounts in the UI language", async () => {
      setLocale("it");
      mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, page(TRANSACTIONS.slice(0, 1))] });
      const { wrapper } = await mountAt("/transactions");
      expect(rows(wrapper)[0][0]).toBe("12 nov 2026");
      // Intl separates the amount and the currency with a non-breaking space
      expect(rows(wrapper)[0][4]).toBe("-42,30\u00a0€");
    });

    it("filters the transactions", async () => {
      const fetch = mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, page(TRANSACTIONS)] });
      const { wrapper, router } = await mountAt("/transactions");
      expect(wrapper.findAll("select[name=wallet] option").map((option) => option.text())).toEqual([
        "All",
        "Bank",
        "Old card",
      ]);
      expect(wrapper.findAll("select[name=kind] option").map((option) => option.text())).toEqual([
        "All",
        "Income",
        "Expenses",
        "Transfers",
      ]);
      expect(wrapper.findAll("select[name=category] option").map((option) => option.text())).toEqual([
        "All",
        "No category",
        "Groceries",
        "Salary",
      ]);

      await wrapper.find("select[name=category]").setValue("none");
      await flushPromises();
      expect(fetch.mock.lastCall[0]).toBe("/api/transactions/?category=none");
      await wrapper.find("select[name=category]").setValue("");

      await wrapper.find("select[name=wallet]").setValue("1");
      await flushPromises();
      expect(fetch.mock.lastCall[0]).toBe("/api/transactions/?wallet=1");

      await wrapper.find("select[name=kind]").setValue("expense");
      await wrapper.find("select[name=category]").setValue("3");
      await wrapper.find("select[name=tag]").setValue("6");
      await wrapper.find("input[name=date_from]").setValue("2026-11-01");
      await wrapper.find("input[name=date_to]").setValue("2026-11-30");
      await flushPromises();
      expect(fetch.mock.lastCall[0]).toBe(
        "/api/transactions/?wallet=1&kind=expense&category=3&tag=6&date_from=2026-11-01&date_to=2026-11-30",
      );
      expect(router.currentRoute.value.fullPath).toBe(
        "/transactions?wallet=1&kind=expense&category=3&tag=6&date_from=2026-11-01&date_to=2026-11-30",
      );
    });

    it("restores the filters from the URL", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/?wallet=1&date_from=2026-11-01": [200, page(TRANSACTIONS.slice(0, 2))],
      });
      // Unknown and repeated parameters are ignored
      const { wrapper } = await mountAt("/transactions?wallet=1&date_from=2026-11-01&tag=5&tag=6&other=1");
      expect(fetch.mock.lastCall[0]).toBe("/api/transactions/?wallet=1&date_from=2026-11-01");
      expect(wrapper.find("select[name=wallet]").element.value).toBe("1");
      expect(wrapper.find("select[name=tag]").element.value).toBe("");
      expect(wrapper.find("input[name=date_from]").element.value).toBe("2026-11-01");
      expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    });

    it("keeps the filters after creating a transaction", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/?wallet=1": [200, page(TRANSACTIONS.slice(0, 2))],
        "POST /api/transactions/": [201, {}],
      });
      const { wrapper, router } = await mountAt("/transactions?wallet=1");
      await wrapper.find("a[href='/transactions/new?wallet=1']").trigger("click");
      await flushPromises();
      await wrapper.find("input[name=amount]").setValue("10");
      await wrapper.find("input[name=description]").setValue("Bakery");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      expect(router.currentRoute.value.fullPath).toBe("/transactions?wallet=1");
      expect(wrapper.find("select[name=wallet]").element.value).toBe("1");
    });

    it("keeps the filters after editing or leaving a transaction", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/?category=3": [200, page([TRANSACTIONS[0]])],
        "GET /api/transactions/7/": [200, TRANSACTIONS[0]],
        "PATCH /api/transactions/7/": [200, TRANSACTIONS[0]],
      });
      const { wrapper, router } = await mountAt("/transactions?category=3");
      await wrapper.find("a[href='/transactions/7?category=3']").trigger("click");
      await flushPromises();
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      expect(router.currentRoute.value.fullPath).toBe("/transactions?category=3");

      await wrapper.find("a[href='/transactions/7?category=3']").trigger("click");
      await flushPromises();
      await wrapper.find("a[href='/transactions?category=3']").trigger("click");
      await flushPromises();
      expect(router.currentRoute.value.fullPath).toBe("/transactions?category=3");
      expect(wrapper.find("select[name=category]").element.value).toBe("3");
    });

    it("shows the filter errors returned by the backend", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/": [200, page(TRANSACTIONS)],
        "GET /api/transactions/?date_to=2026-10-01": [
          400,
          { date_to: ["The end date cannot precede the start date."] },
        ],
      });
      const { wrapper } = await mountAt("/transactions");
      await wrapper.find("input[name=date_to]").setValue("2026-10-01");
      await flushPromises();
      expect(wrapper.find("[role=search]").text()).toContain("The end date cannot precede the start date.");
      expect(wrapper.find("[role=alert]").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("Loading…");
    });

    it("shows a message when no transactions match", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, page([])] });
      const { wrapper } = await mountAt("/transactions");
      expect(wrapper.text()).toContain("No transactions match the filters.");
      expect(wrapper.find("table").exists()).toBe(false);
    });

    describe("pagination", () => {
      const NEXT = "http://testserver/api/transactions/?limit=500&offset=500";
      const button = (wrapper) => wrapper.find("button[name=load-more]");

      it("loads more transactions with the same filters", async () => {
        mockFetch({
          ...LOOKUPS,
          "GET /api/transactions/?wallet=1": [200, page(TRANSACTIONS.slice(0, 1), NEXT)],
          "GET /api/transactions/?wallet=1&offset=1": [200, page(TRANSACTIONS.slice(1, 2), NEXT)],
          "GET /api/transactions/?wallet=1&offset=2": [200, page(TRANSACTIONS.slice(2))],
        });
        const { wrapper } = await mountAt("/transactions?wallet=1");
        expect(wrapper.findAll("tbody tr")).toHaveLength(1);
        expect(button(wrapper).text()).toBe("Load more");

        await button(wrapper).trigger("click");
        await flushPromises();
        expect(wrapper.findAll("tbody tr")).toHaveLength(2);

        await button(wrapper).trigger("click");
        await flushPromises();
        expect(wrapper.findAll("tbody tr td:nth-child(2)").map((cell) => cell.text())).toEqual([
          "Supermarketcarholiday-2026",
          "Pay",
          "Old",
        ]);
        // The last page has no button
        expect(button(wrapper).exists()).toBe(false);
      });

      it("hides the button when everything is loaded", async () => {
        mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, page(TRANSACTIONS)] });
        const { wrapper } = await mountAt("/transactions");
        expect(button(wrapper).exists()).toBe(false);
      });

      it("disables the button while loading", async () => {
        const fetch = mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, page(TRANSACTIONS, NEXT)] });
        const { wrapper } = await mountAt("/transactions");
        fetch.mockImplementation(() => new Promise(() => {}));
        await button(wrapper).trigger("click");
        expect(fetch).toHaveBeenLastCalledWith("/api/transactions/?offset=3", expect.anything());
        expect(button(wrapper).attributes("disabled")).toBeDefined();
        expect(button(wrapper).text()).toBe("Loading…");
      });

      it("shows an error when more transactions cannot be loaded", async () => {
        mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, page(TRANSACTIONS, NEXT)] });
        const { wrapper } = await mountAt("/transactions");
        await button(wrapper).trigger("click");
        await flushPromises();
        expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the transactions: try again later.");
        expect(wrapper.findAll("tbody tr")).toHaveLength(3);
        expect(button(wrapper).attributes("disabled")).toBeUndefined();
      });
    });

    it("shows a loading message while fetching", async () => {
      mockFetch({ "GET /api/auth/me/": [200, USER] });
      fetch.mockImplementation(async (url) =>
        url === "/api/auth/me/" ? { ok: true, status: 200, json: async () => USER } : new Promise(() => {}),
      );
      const { wrapper } = await mountAt("/transactions");
      expect(wrapper.text()).toContain("Loading…");
    });

    it("shows an error when the wallets cannot be loaded", async () => {
      const fetch = mockFetch({ ...LOOKUPS, "GET /api/wallets/": [500, {}] });
      const { wrapper } = await mountAt("/transactions");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the transactions: try again later.");
      expect(fetch).not.toHaveBeenCalledWith("/api/transactions/", expect.anything());
    });

    it("shows an error when the transactions cannot be loaded", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/transactions/": [500, {}] });
      const { wrapper } = await mountAt("/transactions");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the transactions: try again later.");
    });

    describe("deletion", () => {
      it("deletes a transaction after confirmation", async () => {
        const confirm = vi.fn(() => true);
        vi.stubGlobal("confirm", confirm);
        const fetch = mockFetch({
          ...LOOKUPS,
          "GET /api/transactions/": [200, page(structuredClone(TRANSACTIONS))],
          "DELETE /api/transactions/7/": [204],
        });
        const { wrapper } = await mountAt("/transactions");
        await wrapper.find("tbody button").trigger("click");
        await flushPromises();
        expect(confirm).toHaveBeenCalledWith("Delete the transaction Supermarket?");
        expect(fetch).toHaveBeenLastCalledWith("/api/transactions/7/", expect.objectContaining({ method: "DELETE" }));
        expect(rows(wrapper).map((row) => row[1])).toEqual(["Pay", "Old"]);
      });

      it("keeps the transaction when the confirmation is declined", async () => {
        vi.stubGlobal("confirm", () => false);
        const fetch = mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, page(TRANSACTIONS)] });
        const { wrapper } = await mountAt("/transactions");
        const calls = fetch.mock.calls.length;
        await wrapper.find("tbody button").trigger("click");
        await flushPromises();
        expect(fetch).toHaveBeenCalledTimes(calls);
        expect(rows(wrapper)).toHaveLength(3);
      });

      it("shows an error when the deletion fails", async () => {
        vi.stubGlobal("confirm", () => true);
        mockFetch({
          ...LOOKUPS,
          "GET /api/transactions/": [200, page(TRANSACTIONS)],
          "DELETE /api/transactions/7/": [500, {}],
        });
        const { wrapper } = await mountAt("/transactions");
        await wrapper.find("tbody button").trigger("click");
        await flushPromises();
        expect(wrapper.find("[role=alert]").text()).toBe("Unable to delete the transaction: try again later.");
        expect(rows(wrapper)).toHaveLength(3);
      });
    });
  });

  describe("export and import", () => {
    async function choose(wrapper, file = new File(["date,wallet\n"], "transactions.csv", { type: "text/csv" })) {
      const input = wrapper.find("input[name=import]");
      Object.defineProperty(input.element, "files", { value: [file], configurable: true });
      await input.trigger("change");
      await flushPromises();
      return file;
    }

    it("exports the filtered transactions", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, page(TRANSACTIONS)] });
      const { wrapper } = await mountAt("/transactions");
      const link = () => wrapper.find("a[download]");
      expect(link().text()).toBe("Export CSV");
      expect(link().attributes("href")).toBe("/api/transactions/export/");
      await wrapper.find("select[name=wallet]").setValue("1");
      await wrapper.find("input[name=date_from]").setValue("2026-11-01");
      expect(link().attributes("href")).toBe("/api/transactions/export/?wallet=1&date_from=2026-11-01");
    });

    it("imports a file and reloads the transactions", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/": [200, page(TRANSACTIONS)],
        "POST /api/transactions/import/": [201, { transactions: 3, wallets: 1, categories: 0, tags: 2 }],
      });
      const { wrapper } = await mountAt("/transactions");
      const calls = fetch.mock.calls.length;
      const file = await choose(wrapper);
      const [, options] = fetch.mock.calls[calls];
      expect(fetch.mock.calls[calls][0]).toBe("/api/transactions/import/");
      expect(options.body.get("file")).toBe(file);
      expect(wrapper.find("input[name=import]").element.value).toBe("");
      // The new wallets, categories and tags are loaded too
      expect(fetch.mock.calls.slice(calls + 1).map(([url]) => url)).toEqual([
        "/api/wallets/",
        "/api/categories/",
        "/api/tags/",
        "/api/recurring-transactions/due/",
        "/api/transactions/",
      ]);
      expect(wrapper.find("[role=status]").text()).toBe(
        "3 transactions imported. New: 1 wallets, 0 categories, 2 tags.",
      );
    });

    it("imports a file without new wallets, categories and tags", async () => {
      setLocale("it");
      mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/": [200, page(TRANSACTIONS)],
        "POST /api/transactions/import/": [201, { transactions: 1, wallets: 0, categories: 0, tags: 0 }],
      });
      const { wrapper } = await mountAt("/transactions");
      await choose(wrapper);
      expect(wrapper.find("[role=status]").text()).toBe("1 movimento importato.");
    });

    it("shows the invalid rows of the file", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/": [200, page(TRANSACTIONS)],
        "POST /api/transactions/import/": [
          400,
          { file: ["Row 2, amount: The amount cannot be zero.", "Row 3, wallet: This wallet is archived."] },
        ],
      });
      const { wrapper } = await mountAt("/transactions");
      await choose(wrapper);
      const alert = wrapper.find("[role=alert]");
      expect(alert.find("p").text()).toBe("The file was not imported, fix these rows and try again:");
      expect(alert.findAll("li").map((item) => item.text())).toEqual([
        "Row 2, amount: The amount cannot be zero.",
        "Row 3, wallet: This wallet is archived.",
      ]);
      expect(wrapper.find("[role=status]").exists()).toBe(false);
    });

    it("shows an error when the import fails", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/": [200, page(TRANSACTIONS)],
        "POST /api/transactions/import/": [500, {}],
      });
      const { wrapper } = await mountAt("/transactions");
      await choose(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to import the file: try again later.");
      expect(wrapper.find("input[name=import]").attributes("disabled")).toBeUndefined();
    });

    it("disables the import while uploading", async () => {
      const fetch = mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, page(TRANSACTIONS)] });
      const { wrapper } = await mountAt("/transactions");
      fetch.mockImplementation(() => new Promise(() => {}));
      await choose(wrapper);
      expect(wrapper.find("input[name=import]").attributes("disabled")).toBeDefined();
      expect(wrapper.find("label:has(input[name=import])").text()).toBe("Importing…");
    });
  });

  describe("form", () => {
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

    it("creates an expense on the only active wallet", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 10, 12, 23, 30));
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/": [200, page([])],
        "POST /api/transactions/": [201, {}],
      });
      const { wrapper, router } = await mountAt("/transactions");
      await wrapper.find("a[href='/transactions/new']").trigger("click");
      await flushPromises();
      expect(wrapper.find("h1").text()).toBe("New transaction");
      // Archived wallets do not receive new transactions
      expect(wrapper.findAll("select[name=wallet] option").map((option) => option.text())).toEqual([
        "Choose a wallet",
        "Bank (EUR)",
      ]);
      expect(wrapper.find("select[name=wallet]").element.value).toBe("1");
      expect(wrapper.find("input[name=date]").element.value).toBe("2026-11-12");
      expect(wrapper.find("input[name=kind][value=expense]").element.checked).toBe(true);

      await wrapper.find("input[name=amount]").setValue("42.3");
      await wrapper.find("input[name=description]").setValue("Supermarket");
      await wrapper.find("select[name=category]").setValue("3");
      await wrapper.findAll("input[name=tags]")[1].setChecked(true);
      await wrapper.find("textarea[name=notes]").setValue("Weekly shopping");
      expect(wrapper.findAll("input[name=tags]")[1].element.closest("label").classList).toContain("text-white");
      await submit(wrapper);
      expect(lastBody(fetch, "/api/transactions/", "POST")).toEqual({
        wallet: 1,
        date: "2026-11-12",
        description: "Supermarket",
        tags: [6],
        notes: "Weekly shopping",
        amount: "-42.3",
        category: 3,
      });
      expect(router.currentRoute.value.name).toBe("transactions");
    });

    it("creates an income without a category", async () => {
      const wallets = [...WALLETS, { id: 10, name: "Cash", currency: "EUR", owners: [1], is_archived: false }];
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/wallets/": [200, wallets],
        "POST /api/transactions/": [201, {}],
      });
      const { wrapper } = await mountAt("/transactions/new");
      // With many wallets none is chosen in advance
      expect(wrapper.find("select[name=wallet]").element.value).toBe("");
      await wrapper.find("select[name=wallet]").setValue("10");
      await wrapper.find("input[name=kind][value=income]").setChecked(true);
      expect(wrapper.find("input[name=kind][value=income]").element.closest("label").classList).toContain(
        "text-income",
      );
      await wrapper.find("input[name=amount]").setValue("100");
      await wrapper.find("input[name=date]").setValue("2026-11-01");
      await wrapper.find("input[name=description]").setValue("Gift");
      await submit(wrapper);
      expect(lastBody(fetch, "/api/transactions/", "POST")).toEqual({
        wallet: 10,
        date: "2026-11-01",
        description: "Gift",
        tags: [],
        notes: "",
        amount: "100",
        category: null,
      });
    });

    it("edits an income of an archived wallet", async () => {
      const transaction = { ...TRANSACTIONS[1], wallet: 2, category: null, tags: [5] };
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/8/": [200, transaction],
        "PATCH /api/transactions/8/": [200, transaction],
        "GET /api/transactions/": [200, page([transaction])],
      });
      const { wrapper, router } = await mountAt("/transactions/8");
      expect(wrapper.find("h1").text()).toBe("Edit transaction");
      // The current wallet stays available even though it is archived
      expect(wrapper.findAll("select[name=wallet] option")).toHaveLength(3);
      expect(wrapper.find("select[name=wallet]").element.value).toBe("2");
      expect(wrapper.find("input[name=kind][value=income]").element.checked).toBe(true);
      expect(wrapper.find("input[name=amount]").element.value).toBe("1500.00");
      expect(wrapper.find("select[name=category]").element.value).toBe("");
      expect(wrapper.findAll("input[name=tags]").map((input) => input.element.checked)).toEqual([true, false]);

      await wrapper.find("input[name=amount]").setValue("1600");
      await wrapper.findAll("input[name=tags]")[0].setChecked(false);
      await submit(wrapper);
      expect(lastBody(fetch, "/api/transactions/8/", "PATCH")).toEqual({
        wallet: 2,
        date: "2026-11-05",
        description: "Pay",
        tags: [],
        notes: "",
        amount: "1600",
        category: null,
      });
      expect(router.currentRoute.value.name).toBe("transactions");
    });

    it("edits an expense keeping its sign", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/7/": [200, TRANSACTIONS[0]],
        "PATCH /api/transactions/7/": [200, TRANSACTIONS[0]],
        "GET /api/transactions/": [200, page(TRANSACTIONS)],
      });
      const { wrapper } = await mountAt("/transactions/7");
      expect(wrapper.find("input[name=kind][value=expense]").element.checked).toBe(true);
      expect(wrapper.find("input[name=amount]").element.value).toBe("42.30");
      expect(wrapper.find("select[name=category]").element.value).toBe("3");
      expect(wrapper.find("textarea[name=notes]").element.value).toBe("Weekly shopping");
      await submit(wrapper);
      expect(lastBody(fetch, "/api/transactions/7/", "PATCH")).toMatchObject({ amount: "-42.30", category: 3 });
    });

    it("shows the field errors returned by the backend", async () => {
      const errors = {
        wallet: ["This wallet is archived."],
        amount: ["The amount cannot be zero."],
        date: ["Date has wrong format."],
        description: ["This field may not be blank."],
        category: ["Invalid pk."],
        tags: ["Invalid tag."],
        notes: ["Invalid notes."],
      };
      mockFetch({ ...LOOKUPS, "POST /api/transactions/": [400, errors] });
      const { wrapper, router } = await mountAt("/transactions/new");
      await submit(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Check the fields below.");
      for (const messages of Object.values(errors)) {
        expect(wrapper.find("form").text()).toContain(messages[0]);
      }
      expect(wrapper.find("button[type=submit]").attributes("disabled")).toBeUndefined();
      expect(router.currentRoute.value.name).toBe("transaction-new");
    });

    it("shows a generic error when saving fails", async () => {
      mockFetch({ ...LOOKUPS, "POST /api/transactions/": [500, {}] });
      const { wrapper } = await mountAt("/transactions/new");
      await submit(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to save the transaction: try again later.");
    });

    it("shows an error when the transaction cannot be loaded", async () => {
      mockFetch(LOOKUPS);
      const { wrapper } = await mountAt("/transactions/99");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the transaction.");
      expect(wrapper.find("form").exists()).toBe(false);
    });

    it("asks to create a wallet when there are no active wallets", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/wallets/": [200, WALLETS.slice(1)] });
      const { wrapper } = await mountAt("/transactions/new");
      expect(wrapper.find("form").exists()).toBe(false);
      expect(wrapper.text()).toContain("there are no active wallets");
      expect(wrapper.find("a[href='/wallets/new']").text()).toBe("Create a wallet");
    });

    it("explains when there are no tags", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/tags/": [200, []] });
      const { wrapper } = await mountAt("/transactions/new");
      expect(wrapper.find("fieldset:last-of-type").text()).toContain("No tags yet.");
      expect(wrapper.find("input[name=tags]").exists()).toBe(false);
    });
  });
});
