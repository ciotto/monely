import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { setLocale } from "@/i18n";

import { mockFetch, mountAt, page, USER } from "./helpers";

const IMPORT_FORMAT = { date_column: "Data contabile", amount_column: "Importo" };
const WALLET = { id: 1, name: "Bank", currency: "EUR", owners: [1], is_archived: false, import_format: IMPORT_FORMAT };
const MISSING = [
  { id: 11, wallet: 1, date: "2026-11-03", amount: "-9.99", description: "Streaming", is_ignored: false },
  { id: 12, wallet: 1, date: "2026-11-02", amount: "1500.00", description: "", is_ignored: false },
].map((movement) => ({ transaction: null, created_at: "2026-11-16T10:00:00Z", ...movement }));
const IGNORED = [{ ...MISSING[0], id: 13, description: "Refunded", is_ignored: true }];

// Mounted apps would otherwise keep reacting to the shared auth state of the next tests
enableAutoUnmount(afterEach);

describe("bank statements", () => {
  beforeEach(() => {
    setLocale("en");
    Object.assign(auth, { user: null, ready: false, setupRequired: false });
  });

  afterEach(() => vi.unstubAllGlobals());

  // The cells of each movement: date, description, amount and actions
  const items = (wrapper, status) =>
    wrapper.findAll(`[data-movements=${status}] li`).map((item) =>
      item
        .findAll(":scope > span")
        .map((cell) => cell.text())
        .join(" | "),
    );

  describe("import", () => {
    async function choose(wrapper, file = new File(["Data;Importo\n"], "statement.csv", { type: "text/csv" })) {
      const input = wrapper.find("input[name=statement]");
      Object.defineProperty(input.element, "files", { value: [file], configurable: true });
      await input.trigger("change");
      await flushPromises();
      return file;
    }

    const LOOKUPS = {
      "GET /api/auth/me/": [200, USER],
      "GET /api/wallets/1/": [200, WALLET],
      "GET /api/bank-movements/?status=missing&wallet=1": [200, MISSING],
      "GET /api/bank-movements/?status=ignored&wallet=1": [200, IGNORED],
    };

    it("lists the missing and the ignored movements of the wallet", async () => {
      const { wrapper } = await (mockFetch(LOOKUPS), mountAt("/wallets/1/import"));
      expect(wrapper.find("h1").text()).toBe("Import statement · Bank");
      expect(wrapper.find("[data-movements=missing] h2").text()).toBe("Bank movements not entered");
      // The wallet is not repeated on each movement
      expect(items(wrapper, "missing")).toEqual([
        "Nov 3, 2026 | Streaming | -€9.99 | RegisterIgnore",
        "Nov 2, 2026 | No description | +€1,500.00 | RegisterIgnore",
      ]);
      expect(wrapper.find("[data-movements=missing] a").attributes("href")).toBe("/transactions/new?movement=11");
      expect(wrapper.find("[data-movements=ignored] h2").text()).toBe("Ignored bank movements");
      expect(items(wrapper, "ignored")).toEqual(["Nov 3, 2026 | Refunded | -€9.99 | Restore"]);
    });

    it("imports a statement and loads the movements again", async () => {
      const fetch = mockFetch({ ...LOOKUPS, "POST /api/wallets/1/import/": [201, { imported: 3, duplicates: 2 }] });
      const { wrapper } = await mountAt("/wallets/1/import");
      const calls = fetch.mock.calls.length;
      const file = await choose(wrapper);
      const [url, options] = fetch.mock.calls[calls];
      expect([url, options.method]).toEqual(["/api/wallets/1/import/", "POST"]);
      expect(options.body.get("file")).toBe(file);
      expect(wrapper.find("input[name=statement]").element.value).toBe("");
      expect(wrapper.find("[role=status]").text()).toBe("3 new movements. 2 movements were already imported.");
      expect(fetch.mock.calls.slice(calls + 1).map(([url]) => url)).toEqual([
        "/api/bank-movements/?status=missing&wallet=1",
        "/api/bank-movements/?status=ignored&wallet=1",
      ]);
    });

    it("imports a statement without new movements", async () => {
      setLocale("it");
      mockFetch({ ...LOOKUPS, "POST /api/wallets/1/import/": [201, { imported: 0, duplicates: 0 }] });
      const { wrapper } = await mountAt("/wallets/1/import");
      await choose(wrapper);
      expect(wrapper.find("[role=status]").text()).toBe("Nessun movimento nuovo.");
    });

    it("shows why the statement was rejected", async () => {
      mockFetch({
        ...LOOKUPS,
        "POST /api/wallets/1/import/": [400, { file: ["No row of the file has the columns: Data contabile."] }],
      });
      const { wrapper } = await mountAt("/wallets/1/import");
      await choose(wrapper);
      const alert = wrapper.find("[role=alert]");
      expect(alert.find("p").text()).toBe("The statement was not imported:");
      expect(alert.findAll("li").map((item) => item.text())).toEqual([
        "No row of the file has the columns: Data contabile.",
      ]);
      expect(wrapper.find("[role=status]").exists()).toBe(false);
    });

    it("shows an error when the import fails", async () => {
      mockFetch({ ...LOOKUPS, "POST /api/wallets/1/import/": [500, {}] });
      const { wrapper } = await mountAt("/wallets/1/import");
      await choose(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to import the statement: try again later.");
      expect(wrapper.find("input[name=statement]").attributes("disabled")).toBeUndefined();
    });

    it("disables the import while uploading", async () => {
      const fetch = mockFetch(LOOKUPS);
      const { wrapper } = await mountAt("/wallets/1/import");
      fetch.mockImplementation(() => new Promise(() => {}));
      await choose(wrapper);
      expect(wrapper.find("input[name=statement]").attributes("disabled")).toBeDefined();
      expect(wrapper.find("label:has(input[name=statement])").text()).toBe("Importing…");
    });

    it("ignores a movement and restores it", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "PATCH /api/bank-movements/11/": [200, { ...MISSING[0], is_ignored: true }],
        "PATCH /api/bank-movements/13/": [200, { ...IGNORED[0], is_ignored: false }],
      });
      const { wrapper } = await mountAt("/wallets/1/import");
      await wrapper.find("[data-movements=missing] button[name=toggle]").trigger("click");
      await flushPromises();
      const [, { body }] = fetch.mock.calls.find(([url]) => url === "/api/bank-movements/11/");
      expect(JSON.parse(body)).toEqual({ is_ignored: true });
      // Both lists are loaded again
      expect(fetch.mock.calls.slice(-2).map(([url]) => url)).toEqual([
        "/api/bank-movements/?status=missing&wallet=1",
        "/api/bank-movements/?status=ignored&wallet=1",
      ]);

      await wrapper.find("[data-movements=ignored] button[name=toggle]").trigger("click");
      await flushPromises();
      const [, { body: restored }] = fetch.mock.calls.find(([url]) => url === "/api/bank-movements/13/");
      expect(JSON.parse(restored)).toEqual({ is_ignored: false });
    });

    it("shows an error when a movement cannot be ignored", async () => {
      mockFetch({ ...LOOKUPS, "PATCH /api/bank-movements/11/": [500, {}] });
      const { wrapper } = await mountAt("/wallets/1/import");
      await wrapper.find("[data-movements=missing] button[name=toggle]").trigger("click");
      await flushPromises();
      expect(wrapper.find("[data-movements=missing] [role=alert]").text()).toBe(
        "Unable to update the bank movement: try again later.",
      );
      expect(items(wrapper, "missing")).toHaveLength(2);
    });

    it("asks to set up the import format", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/wallets/1/": [200, { ...WALLET, import_format: null }] });
      const { wrapper } = await mountAt("/wallets/1/import");
      expect(wrapper.text()).toContain("The import format of this wallet is not set.");
      expect(wrapper.find("a[href='/wallets/1']").text()).toBe("Set it up");
      expect(wrapper.find("input[name=statement]").exists()).toBe(false);
      expect(wrapper.find("[data-movements]").exists()).toBe(false);
    });

    it("shows an error when the wallet cannot be loaded", async () => {
      mockFetch({ "GET /api/auth/me/": [200, USER] });
      const { wrapper } = await mountAt("/wallets/1/import");
      expect(wrapper.find("h1").text()).toBe("Import statement");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the wallet.");
    });
  });

  describe("transactions", () => {
    const WALLETS = [
      { id: 1, name: "Bank", currency: "EUR", owners: [1], is_archived: false },
      { id: 2, name: "Card", currency: "USD", owners: [1], is_archived: false },
    ];
    const LOOKUPS = {
      "GET /api/auth/me/": [200, USER],
      "GET /api/wallets/": [200, WALLETS],
      "GET /api/categories/": [200, []],
      "GET /api/tags/": [200, []],
      "GET /api/recurring-transactions/due/": [200, []],
      "GET /api/transactions/": [200, page([])],
      "GET /api/transactions/?wallet=1": [200, page([])],
    };

    describe("statements link", () => {
      const withFormat = (wallet) => ({ ...wallet, import_format: IMPORT_FORMAT });

      it("links the import of the only wallet with an import format, with the movements to check", async () => {
        mockFetch({
          ...LOOKUPS,
          "GET /api/wallets/": [200, [withFormat(WALLETS[0]), WALLETS[1]]],
          "GET /api/bank-movements/?status=missing": [200, MISSING],
          "PATCH /api/bank-movements/11/": [200, { ...MISSING[0], is_ignored: true }],
        });
        const { wrapper } = await mountAt("/transactions");
        const link = () => wrapper.find("a[data-statements]");
        expect(link().attributes("href")).toBe("/wallets/1/import");
        expect(link().attributes("title")).toBe("2 movements to check");
        expect(link().find("[data-count]").text()).toBe("2");

        // Ignoring a movement updates the count
        await wrapper.find("[data-movements=missing] button[name=toggle]").trigger("click");
        await flushPromises();
        expect(link().find("[data-count]").text()).toBe("1");
      });

      it("shows no count when there is nothing to check", async () => {
        mockFetch({ ...LOOKUPS, "GET /api/wallets/": [200, [withFormat(WALLETS[0])]] });
        const { wrapper } = await mountAt("/transactions");
        expect(wrapper.find("a[data-statements]").text()).toBe("Bank statements");
        expect(wrapper.find("a[data-statements]").attributes("title")).toBe("Nothing to check");
        expect(wrapper.find("[data-count]").exists()).toBe(false);
      });

      it("lists the wallets with an import format, each with its movements to check", async () => {
        setLocale("it");
        const archived = { id: 3, name: "Old", currency: "EUR", owners: [1], is_archived: true };
        mockFetch({
          ...LOOKUPS,
          "GET /api/wallets/": [200, [...WALLETS.map(withFormat), withFormat(archived)]],
          "GET /api/bank-movements/?status=missing": [200, MISSING],
        });
        const { wrapper, router } = await mountAt("/transactions");
        const button = wrapper.find("button[name=statements]");
        expect(button.text()).toBe("Estratti conto 2");
        expect(button.find("[data-count]").attributes("title")).toBe("2 movimenti della banca da controllare");

        await button.trigger("click");
        // Archived wallets do not receive new transactions
        const items = wrapper.findAll("[data-menu=statements] a");
        expect(items.map((item) => [item.attributes("href"), item.text().replace(/\s+/g, " ")])).toEqual([
          ["/wallets/1/import", "Bank 2 movimenti della banca da controllare"],
          ["/wallets/2/import", "Card Niente da controllare"],
        ]);
        await items[1].trigger("click");
        await flushPromises();
        expect(router.currentRoute.value.name).toBe("wallet-import");
      });

      it("is not shown without wallets with an import format", async () => {
        mockFetch(LOOKUPS);
        const { wrapper } = await mountAt("/transactions");
        expect(wrapper.find("a[data-statements]").exists()).toBe(false);
        expect(wrapper.find("button[name=statements]").exists()).toBe(false);
      });
    });

    it("lists the missing movements of every wallet", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/bank-movements/?status=missing": [200, [...MISSING, { ...MISSING[0], id: 14, wallet: 2 }]],
      });
      const { wrapper } = await mountAt("/transactions?wallet=1");
      expect(items(wrapper, "missing")).toEqual([
        "Nov 3, 2026 | Streaming · Bank | -€9.99 | RegisterIgnore",
        "Nov 2, 2026 | No description · Bank | +€1,500.00 | RegisterIgnore",
        "Nov 3, 2026 | Streaming · Card | -$9.99 | RegisterIgnore",
      ]);
      // Back to the same list after registering the movement
      expect(wrapper.find("[data-movements=missing] a").attributes("href")).toBe(
        "/transactions/new?wallet=1&movement=11",
      );
    });

    it("hides the movements when they cannot be loaded", async () => {
      mockFetch(LOOKUPS);
      const { wrapper } = await mountAt("/transactions");
      expect(wrapper.find("[data-movements]").exists()).toBe(false);
      expect(wrapper.find("[role=alert]").exists()).toBe(false);
    });

    it("ignores a missing movement", async () => {
      mockFetch({
        ...LOOKUPS,
        "GET /api/bank-movements/?status=missing": [200, MISSING],
        "PATCH /api/bank-movements/11/": [200, { ...MISSING[0], is_ignored: true }],
      });
      const { wrapper } = await mountAt("/transactions");
      await wrapper.find("[data-movements=missing] button[name=toggle]").trigger("click");
      await flushPromises();
      expect(items(wrapper, "missing")).toEqual(["Nov 2, 2026 | No description · Bank | +€1,500.00 | RegisterIgnore"]);
    });

    it("registers a movement with the form filled in", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/bank-movements/?status=missing": [200, MISSING],
        "GET /api/bank-movements/11/": [200, MISSING[0]],
        "POST /api/transactions/": [201, {}],
      });
      const { wrapper, router } = await mountAt("/transactions?wallet=1");
      await wrapper.find("[data-movements=missing] a").trigger("click");
      await flushPromises();
      expect(wrapper.find("[data-movement]").text()).toBe(
        "This transaction registers the bank movement of Nov 3, 2026.",
      );
      expect(wrapper.find("select[name=wallet]").element.value).toBe("1");
      expect(wrapper.find("input[name=kind][value=expense]").element.checked).toBe(true);
      expect(wrapper.find("input[name=amount]").element.value).toBe("9.99");
      expect(wrapper.find("input[name=date]").element.value).toBe("2026-11-03");
      expect(wrapper.find("input[name=description]").element.value).toBe("Streaming");
      await wrapper.find("form").trigger("submit");
      await flushPromises();
      const [, { body }] = fetch.mock.calls.findLast(([url, { method }]) => {
        return url === "/api/transactions/" && method === "POST";
      });
      // The transaction is reconciled with the movement by date and amount, without a link
      expect(JSON.parse(body)).toEqual({
        wallet: 1,
        date: "2026-11-03",
        description: "Streaming",
        tags: [],
        notes: "",
        is_shared: false,
        amount: "-9.99",
        category: null,
      });
      expect(router.currentRoute.value.fullPath).toBe("/transactions?wallet=1");
    });
  });
});
