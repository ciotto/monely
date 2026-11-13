import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { setLocale } from "@/i18n";

import { mockFetch, mountAt, USER } from "./helpers";

const WALLETS = [
  { id: 1, name: "Bank", currency: "EUR", owners: [1], is_archived: false },
  { id: 2, name: "Cash", currency: "EUR", owners: [1], is_archived: false },
  { id: 3, name: "US account", currency: "USD", owners: [1], is_archived: false },
  { id: 4, name: "Old card", currency: "EUR", owners: [1], is_archived: true },
];
const TRANSFER = {
  id: 9,
  from_wallet: 4,
  to_wallet: 2,
  date: "2026-11-10",
  amount: "50.00",
  description: "ATM",
  notes: "Holiday money",
};
// One transfer and a plain transaction, newest first
const TRANSACTIONS = [
  {
    id: 11,
    wallet: 2,
    date: "2026-11-10",
    amount: "50.00",
    description: "ATM",
    category: null,
    tags: [],
    notes: "",
    transfer: 9,
  },
  {
    id: 10,
    wallet: 1,
    date: "2026-11-10",
    amount: "-50.00",
    description: "ATM",
    category: null,
    tags: [],
    notes: "",
    transfer: 9,
  },
  {
    id: 7,
    wallet: 1,
    date: "2026-11-05",
    amount: "-5.00",
    description: "Coffee",
    category: null,
    tags: [],
    notes: "",
    transfer: null,
  },
];
const LOOKUPS = {
  "GET /api/auth/me/": [200, USER],
  "GET /api/wallets/": [200, WALLETS],
  "GET /api/categories/": [200, []],
  "GET /api/tags/": [200, []],
};

// Mounted apps would otherwise keep reacting to the shared auth state of the next tests
enableAutoUnmount(afterEach);

describe("transfers", () => {
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

    it("shows the transactions of a transfer, linked to the transfer", async () => {
      mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, TRANSACTIONS] });
      const { wrapper } = await mountAt("/transactions");
      expect(rows(wrapper).map((row) => row.slice(1, 5))).toEqual([
        ["ATM", "Transfer", "Cash", "+€50.00"],
        ["ATM", "Transfer", "Bank", "-€50.00"],
        ["Coffee", "", "Bank", "-€5.00"],
      ]);
      expect(wrapper.findAll("[data-transfer] svg")).toHaveLength(2);
      expect(wrapper.findAll("tbody a").map((link) => link.attributes("href"))).toEqual([
        "/transfers/9",
        "/transfers/9",
        "/transactions/7",
      ]);
    });

    it("deletes both transactions of a transfer after confirmation", async () => {
      const confirm = vi.fn(() => true);
      vi.stubGlobal("confirm", confirm);
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/": [200, TRANSACTIONS],
        "DELETE /api/transfers/9/": [204],
      });
      const { wrapper } = await mountAt("/transactions");
      await wrapper.find("tbody button").trigger("click");
      await flushPromises();
      expect(confirm).toHaveBeenCalledWith("Delete the transfer ATM? Both its transactions will be deleted.");
      expect(fetch).toHaveBeenLastCalledWith("/api/transfers/9/", expect.objectContaining({ method: "DELETE" }));
      expect(rows(wrapper).map((row) => row[1])).toEqual(["Coffee"]);
    });

    it("keeps the transfer when the confirmation is declined", async () => {
      vi.stubGlobal("confirm", () => false);
      const fetch = mockFetch({ ...LOOKUPS, "GET /api/transactions/": [200, TRANSACTIONS] });
      const { wrapper } = await mountAt("/transactions");
      const calls = fetch.mock.calls.length;
      await wrapper.find("tbody button").trigger("click");
      await flushPromises();
      expect(fetch).toHaveBeenCalledTimes(calls);
      expect(rows(wrapper)).toHaveLength(3);
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

    const options = (wrapper, name) => wrapper.findAll(`select[name=${name}] option`).map((option) => option.text());

    it("creates a transfer from the transactions page", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date(2026, 10, 12, 23, 30));
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/transactions/": [200, []],
        "POST /api/transfers/": [201, {}],
      });
      const { wrapper, router } = await mountAt("/transactions");
      await wrapper.find("a[href='/transfers/new']").trigger("click");
      await flushPromises();
      expect(wrapper.find("h1").text()).toBe("New transfer");
      expect(wrapper.find("input[name=date]").element.value).toBe("2026-11-12");
      expect(wrapper.find("input[name=description]").element.value).toBe("Transfer");
      // Archived wallets do not receive new transfers
      expect(options(wrapper, "from_wallet")).toEqual([
        "Choose a wallet",
        "Bank (EUR)",
        "Cash (EUR)",
        "US account (USD)",
      ]);
      expect(options(wrapper, "to_wallet")).toEqual([
        "Choose a wallet",
        "Bank (EUR)",
        "Cash (EUR)",
        "US account (USD)",
      ]);

      await wrapper.find("select[name=from_wallet]").setValue("1");
      // Only the other wallets with the same currency can receive the money
      expect(options(wrapper, "to_wallet")).toEqual(["Choose a wallet", "Cash (EUR)"]);
      await wrapper.find("select[name=to_wallet]").setValue("2");
      await wrapper.find("input[name=amount]").setValue("200");
      await wrapper.find("input[name=description]").setValue("ATM");
      await wrapper.find("textarea[name=notes]").setValue("Holiday money");
      await submit(wrapper);
      expect(lastBody(fetch, "/api/transfers/", "POST")).toEqual({
        from_wallet: 1,
        to_wallet: 2,
        amount: "200",
        date: "2026-11-12",
        description: "ATM",
        notes: "Holiday money",
      });
      expect(router.currentRoute.value.name).toBe("transactions");
    });

    it("clears the destination when it no longer matches the source", async () => {
      mockFetch(LOOKUPS);
      const { wrapper } = await mountAt("/transfers/new");
      await wrapper.find("select[name=from_wallet]").setValue("1");
      await wrapper.find("select[name=to_wallet]").setValue("2");
      // A source with another currency keeps no destination
      await wrapper.find("select[name=from_wallet]").setValue("3");
      await flushPromises();
      expect(options(wrapper, "to_wallet")).toEqual(["Choose a wallet"]);
      expect(wrapper.find("select[name=to_wallet]").element.value).toBe("");
    });

    it("edits a transfer of an archived wallet", async () => {
      const fetch = mockFetch({
        ...LOOKUPS,
        "GET /api/transfers/9/": [200, TRANSFER],
        "PATCH /api/transfers/9/": [200, TRANSFER],
        "GET /api/transactions/": [200, TRANSACTIONS],
      });
      const { wrapper, router } = await mountAt("/transfers/9");
      expect(wrapper.find("h1").text()).toBe("Edit transfer");
      // The current wallet stays available even though it is archived
      expect(options(wrapper, "from_wallet")).toContain("Old card (EUR)");
      expect(wrapper.find("select[name=from_wallet]").element.value).toBe("4");
      expect(wrapper.find("select[name=to_wallet]").element.value).toBe("2");
      expect(wrapper.find("input[name=amount]").element.value).toBe("50.00");
      expect(wrapper.find("input[name=description]").element.value).toBe("ATM");
      expect(wrapper.find("textarea[name=notes]").element.value).toBe("Holiday money");

      await wrapper.find("input[name=amount]").setValue("60");
      await wrapper.find("input[name=date]").setValue("2026-11-11");
      await submit(wrapper);
      expect(lastBody(fetch, "/api/transfers/9/", "PATCH")).toEqual({
        from_wallet: 4,
        to_wallet: 2,
        amount: "60",
        date: "2026-11-11",
        description: "ATM",
        notes: "Holiday money",
      });
      expect(router.currentRoute.value.name).toBe("transactions");
    });

    it("shows the field errors returned by the backend", async () => {
      const errors = {
        from_wallet: ["This wallet is archived."],
        to_wallet: ["The wallets must use the same currency."],
        amount: ["Ensure this value is greater than or equal to 0.01."],
        date: ["Date has wrong format."],
        description: ["This field may not be blank."],
        notes: ["Invalid notes."],
      };
      mockFetch({ ...LOOKUPS, "POST /api/transfers/": [400, errors] });
      const { wrapper, router } = await mountAt("/transfers/new");
      await submit(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Check the fields below.");
      for (const messages of Object.values(errors)) {
        expect(wrapper.find("form").text()).toContain(messages[0]);
      }
      expect(wrapper.find("button[type=submit]").attributes("disabled")).toBeUndefined();
      expect(router.currentRoute.value.name).toBe("transfer-new");
    });

    it("shows a generic error when saving fails", async () => {
      mockFetch({ ...LOOKUPS, "POST /api/transfers/": [500, {}] });
      const { wrapper } = await mountAt("/transfers/new");
      await submit(wrapper);
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to save the transfer: try again later.");
    });

    it("shows an error when the transfer cannot be loaded", async () => {
      mockFetch(LOOKUPS);
      const { wrapper } = await mountAt("/transfers/99");
      expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the transfer.");
      expect(wrapper.find("form").exists()).toBe(false);
    });

    it("asks to create a wallet when there are fewer than two active wallets", async () => {
      setLocale("it");
      mockFetch({ ...LOOKUPS, "GET /api/wallets/": [200, WALLETS.slice(2)] });
      const { wrapper } = await mountAt("/transfers/new");
      expect(wrapper.find("form").exists()).toBe(false);
      expect(wrapper.text()).toContain("meno di due portafogli attivi");
      expect(wrapper.find("a[href='/wallets/new']").text()).toBe("Crea un portafoglio");
    });
  });
});
