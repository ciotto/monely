import { enableAutoUnmount, flushPromises } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { auth } from "@/auth";
import { setLocale } from "@/i18n";

import { mockFetch, mountAt, page, USER } from "./helpers";

// jsdom has no canvas: the charts record their configuration instead of drawing
const charts = vi.hoisted(() => []);
vi.mock("chart.js", () => {
  class Chart {
    static register = vi.fn();

    constructor(canvas, config) {
      this.canvas = canvas;
      this.config = config;
      this.data = config.data;
      this.update = vi.fn();
      this.destroy = vi.fn();
      charts.push(this);
    }
  }
  return { Chart, BarController: {}, BarElement: {}, CategoryScale: {}, Legend: {}, LinearScale: {}, Tooltip: {} };
});

const WALLETS = [
  { id: 1, name: "Bank", currency: "EUR", owners: [1], is_archived: false },
  { id: 2, name: "US account", currency: "USD", owners: [1], is_archived: false },
  { id: 9, name: "Old card", currency: "EUR", owners: [1], is_archived: true },
];
const CATEGORIES = [
  { id: 3, name: "Groceries", color: "#16a34a", icon: "shopping-cart" },
  { id: 4, name: "Salary", color: "#2563eb", icon: "" },
  { id: 5, name: "Rent", color: "#dc2626", icon: "" },
  { id: 6, name: "Car", color: "#7c3aed", icon: "" },
  { id: 7, name: "Gifts", color: "#db2777", icon: "" },
  { id: 8, name: "Home", color: "#0891b2", icon: "" },
];

// The amounts of a category in the month, the previous month and the same month of the previous year
function category(id, [income, expenses], [monthIncome, monthExpenses], [yearIncome, yearExpenses]) {
  return {
    category: id,
    income,
    expenses,
    previous_month_income: monthIncome,
    previous_month_expenses: monthExpenses,
    previous_year_income: yearIncome,
    previous_year_expenses: yearExpenses,
  };
}

const EUR = {
  currency: "EUR",
  income: "1505.00",
  expenses: "-52.30",
  net: "1452.70",
  previous_year: { income: "1400.00", expenses: "-30.00", net: "1370.00" },
  categories: [
    category(3, ["5.00", "-42.30"], ["0.00", "-60.00"], ["0.00", "-30.00"]),
    category(4, ["1500.00", "0.00"], ["1500.00", "0.00"], ["1400.00", "-5.00"]),
    category(5, ["0.00", "0.00"], ["0.00", "-800.00"], ["0.00", "-800.00"]),
    category(6, ["0.00", "0.00"], ["0.00", "-800.00"], ["0.00", "-100.00"]),
    category(7, ["0.00", "0.00"], ["0.00", "-800.00"], ["0.00", "-100.00"]),
    category(null, ["0.00", "-10.00"], ["0.00", "0.00"], ["0.00", "0.00"]),
  ],
  budgets: [],
};
// The budgets of the month, as computed by the backend
const BUDGETS = [
  {
    id: 10,
    category: 6,
    currency: "EUR",
    amount: "150.00",
    transactions: "30.00",
    recurring: "100.00",
    spent: "130.00",
    remaining: "20.00",
    recurring_transactions: [{ id: 7, description: "Insurance", share: "100.00" }],
  },
  {
    id: 11,
    category: 3,
    currency: "EUR",
    amount: "40.00",
    transactions: "42.30",
    recurring: "0.00",
    spent: "42.30",
    remaining: "-2.30",
    recurring_transactions: [],
  },
  // Only a recurring transaction weighs on it, so the category has no transactions
  {
    id: 12,
    category: 8,
    currency: "EUR",
    amount: "50.00",
    transactions: "0.00",
    recurring: "25.00",
    spent: "25.00",
    remaining: "25.00",
    recurring_transactions: [{ id: 8, description: "Cleaning", share: "25.00" }],
  },
];
const DASHBOARD = {
  month: "2026-11",
  previous_month: "2026-10",
  previous_year: "2025-11",
  currencies: [EUR],
  wallets: [{ id: 1, name: "Bank", currency: "EUR", balance: "-2722.70" }],
};
const LOOKUPS = {
  "GET /api/auth/me/": [200, USER],
  "GET /api/wallets/": [200, WALLETS],
  "GET /api/categories/": [200, CATEGORIES],
};

// Mounted apps would otherwise keep reacting to the shared auth state of the next tests
enableAutoUnmount(afterEach);

describe("dashboard", () => {
  beforeEach(() => {
    setLocale("en");
    Object.assign(auth, { user: null, ready: false, setupRequired: false });
    charts.length = 0;
  });

  afterEach(() => vi.unstubAllGlobals());

  const tiles = (wrapper) => wrapper.findAll("[data-tile]").map((tile) => tile.findAll("p").map((p) => p.text()));
  const rows = (wrapper) => wrapper.findAll("tbody tr").map((row) => row.findAll("td").map((cell) => cell.text()));

  it("summarizes the current month", async () => {
    const fetch = mockFetch({ ...LOOKUPS, "GET /api/dashboard/": [200, DASHBOARD] });
    const { wrapper } = await mountAt("/");
    expect(fetch).toHaveBeenCalledWith("/api/dashboard/", expect.anything());
    expect(wrapper.find("h1").text()).toBe("Dashboard");
    expect(wrapper.text()).toContain("November 2026");
    expect(wrapper.find("input[name=month]").element.value).toBe("2026-11");
    // Archived wallets are not offered
    expect(wrapper.findAll("select[name=wallet] option").map((option) => option.text())).toEqual([
      "All wallets",
      "Bank",
      "US account",
    ]);
    expect(wrapper.find("h2").text()).toBe("Balances at the end of November 2026");
    expect(tiles(wrapper)).toEqual([
      ["Income", "€1,505.00", "Nov 2025: €1,400.00 (+8%)"],
      ["Expenses", "€52.30", "Nov 2025: €30.00 (+74%)"],
      ["Balance", "+€1,452.70", "Nov 2025: +€1,370.00 (+6%)"],
    ]);
    expect(wrapper.findAll("li").map((item) => item.text())).toEqual(["Bank-€2,722.70"]);
    // Without budgets there is no budget column
    expect(wrapper.find("[data-budget-note]").exists()).toBe(false);
  });

  it("shows the budgets of the month in the expenses by category", async () => {
    const summary = { ...EUR, budgets: BUDGETS };
    mockFetch({
      ...LOOKUPS,
      "GET /api/dashboard/": [200, { ...DASHBOARD, currencies: [summary] }],
      "GET /api/budgets/summary/?month=2026-11": [200, { month: "2026-11", budgets: BUDGETS }],
    });
    const { wrapper, router } = await mountAt("/");
    expect(wrapper.findAll("thead th").map((cell) => cell.text())).toEqual([
      "Category",
      "Nov 2026",
      "Oct 2026",
      "Nov 2025",
      "Budget",
    ]);
    // The month of a category with a budget counts what the budget spent, recurring shares included
    expect(rows(wrapper)).toEqual([
      ["Car", "€130.00", "€800.00", "€100.00", "€150.00 €20.00 left"],
      ["Groceries", "€42.30", "€60.00", "€30.00", "€40.00 €2.30 over budget"],
      ["Home", "€25.00", "€0.00", "€0.00", "€50.00 €25.00 left"],
      ["Uncategorized", "€10.00", "€0.00", "€0.00", ""],
      ["Rent", "€0.00", "€800.00", "€800.00", ""],
      ["Gifts", "€0.00", "€800.00", "€100.00", ""],
      ["Salary", "€0.00", "€0.00", "€5.00", ""],
    ]);
    expect(wrapper.findAll("td[data-budget] span")[1].classes()).toContain("text-expense");
    expect(wrapper.findAll("td[data-budget] span")[0].classes()).not.toContain("text-expense");

    // The bar of the month stacks what is left of the budget, or what goes over it, on what it spent
    const [chart] = charts;
    expect(
      chart.data.datasets.map(({ label, data, backgroundColor, stack }) => [label, data, backgroundColor, stack]),
    ).toEqual([
      ["Nov 2026", [130, 40, 25, 10, 0, 0, 0], "#0f766e", "current"],
      ["Budget left", [20, 0, 25, null, null, null, null], "#99f6e4", "current"],
      ["Over budget", [0, 2.3, 0, null, null, null, null], "#b91c1c", "current"],
      ["Oct 2026", [800, 60, 0, 0, 800, 800, 0], "#d97706", "3"],
      ["Nov 2025", [100, 30, 0, 0, 800, 100, 5], "#94a3b8", "4"],
    ]);
    expect(chart.config.options.scales.x.stacked).toBe(true);
    // The parts that do not apply to a category are left out of the tooltip
    const filter = chart.config.options.plugins.tooltip.filter;
    expect([filter({ raw: null }), filter({ raw: 0 })]).toEqual([false, true]);

    // The budgets are about the expenses
    await wrapper.findAll("[role=group] button")[1].trigger("click");
    expect(wrapper.findAll("thead th")).toHaveLength(4);
    expect(chart.data.datasets.map(({ label }) => label)).toEqual(["Nov 2026", "Oct 2026", "Nov 2025"]);
    expect(wrapper.find("[data-budget-note]").exists()).toBe(false);
    await wrapper.findAll("[role=group] button")[0].trigger("click");

    // The budgets page opens on the same month
    const note = wrapper.find("[data-budget-note]");
    expect(note.text()).toContain("monthly share");
    expect(note.find("a").text()).toBe("Manage budgets");
    expect(note.find("a").attributes("href")).toBe("/budgets?month=2026-11");
    await note.find("a").trigger("click");
    await flushPromises();
    expect(router.currentRoute.value.name).toBe("budgets");
    expect(wrapper.find("input[name=month]").element.value).toBe("2026-11");
  });

  it("does not use the budget when the refunds exceed the expenses", async () => {
    const refunded = { ...BUDGETS[0], transactions: "-5.00", recurring: "0.00", spent: "-5.00", remaining: "155.00" };
    mockFetch({
      ...LOOKUPS,
      "GET /api/dashboard/": [200, { ...DASHBOARD, currencies: [{ ...EUR, budgets: [refunded] }] }],
    });
    await mountAt("/");
    const [chart] = charts;
    const car = chart.data.labels.indexOf("Car");
    expect(chart.data.datasets.slice(0, 3).map(({ data }) => data[car])).toEqual([0, 150, 0]);
  });

  it("breaks the expenses down by category", async () => {
    mockFetch({ ...LOOKUPS, "GET /api/dashboard/": [200, DASHBOARD] });
    const { wrapper } = await mountAt("/");
    expect(wrapper.findAll("thead th").map((cell) => cell.text())).toEqual([
      "Category",
      "Nov 2026",
      "Oct 2026",
      "Nov 2025",
    ]);
    // Sorted by the amount of the month, then by the previous month and the previous year
    expect(rows(wrapper)).toEqual([
      ["Groceries", "€42.30", "€60.00", "€30.00"],
      ["Uncategorized", "€10.00", "€0.00", "€0.00"],
      ["Rent", "€0.00", "€800.00", "€800.00"],
      ["Car", "€0.00", "€800.00", "€100.00"],
      ["Gifts", "€0.00", "€800.00", "€100.00"],
      ["Salary", "€0.00", "€0.00", "€5.00"],
    ]);
    expect(wrapper.find("tbody svg").exists()).toBe(true);
    const dots = wrapper.findAll("tbody span.rounded-full").map((dot) => dot.attributes("style"));
    expect(dots).toEqual([
      "background-color: rgb(203, 213, 225);",
      "background-color: rgb(220, 38, 38);",
      "background-color: rgb(124, 58, 237);",
      "background-color: rgb(219, 39, 119);",
      "background-color: rgb(37, 99, 235);",
    ]);

    const [chart] = charts;
    expect(chart.canvas.getAttribute("aria-label")).toBe(
      "Expenses by category, compared with the previous month and the same month of the previous year",
    );
    expect(chart.config.options.indexAxis).toBe("y");
    expect(chart.data.labels).toEqual(["Groceries", "Uncategorized", "Rent", "Car", "Gifts", "Salary"]);
    expect(chart.data.datasets.map(({ label, data, backgroundColor }) => [label, data, backgroundColor])).toEqual([
      ["Nov 2026", [42.3, 10, 0, 0, 0, 0], "#0f766e"],
      ["Oct 2026", [60, 0, 800, 800, 800, 0], "#d97706"],
      ["Nov 2025", [30, 0, 800, 100, 100, 5], "#94a3b8"],
    ]);
    expect(chart.config.options.scales.x.ticks.callback(800)).toBe("€800");
    const tooltip = chart.config.options.plugins.tooltip.callbacks.label;
    expect(tooltip({ dataset: { label: "Nov 2026" }, parsed: { x: 42.3 } })).toBe("Nov 2026: €42.30");
  });

  it("switches the breakdown to the income", async () => {
    mockFetch({ ...LOOKUPS, "GET /api/dashboard/": [200, DASHBOARD] });
    const { wrapper } = await mountAt("/");
    const [expenses, income] = wrapper.findAll("[role=group] button");
    expect(expenses.attributes("aria-pressed")).toBe("true");
    await income.trigger("click");
    expect(income.attributes("aria-pressed")).toBe("true");
    expect(expenses.attributes("aria-pressed")).toBe("false");
    expect(rows(wrapper)).toEqual([
      ["Salary", "€1,500.00", "€1,500.00", "€1,400.00"],
      ["Groceries", "€5.00", "€0.00", "€0.00"],
    ]);
    const [chart] = charts;
    expect(chart.update).toHaveBeenCalled();
    expect(chart.data.labels).toEqual(["Salary", "Groceries"]);
  });

  it("switches the breakdown to the balance", async () => {
    mockFetch({ ...LOOKUPS, "GET /api/dashboard/": [200, DASHBOARD] });
    const { wrapper } = await mountAt("/");
    const net = wrapper.findAll("[role=group] button")[2];
    expect(net.text()).toBe("Balance");
    await net.trigger("click");
    // Incomes and expenses are summed, keeping the sign; the biggest movements come first
    expect(rows(wrapper)).toEqual([
      ["Salary", "+€1,500.00", "+€1,500.00", "+€1,395.00"],
      ["Groceries", "-€37.30", "-€60.00", "-€30.00"],
      ["Uncategorized", "-€10.00", "€0.00", "€0.00"],
      ["Rent", "€0.00", "-€800.00", "-€800.00"],
      ["Car", "€0.00", "-€800.00", "-€100.00"],
      ["Gifts", "€0.00", "-€800.00", "-€100.00"],
    ]);
    const [chart] = charts;
    expect(chart.data.datasets[0].data).toEqual([1500, -37.3, -10, 0, 0, 0]);
    expect(chart.canvas.getAttribute("aria-label")).toContain("Balance by category");
    const tooltip = chart.config.options.plugins.tooltip.callbacks.label;
    expect(tooltip({ dataset: { label: "Nov 2026" }, parsed: { x: 1500 } })).toBe("Nov 2026: +€1,500.00");
  });

  it("explains when there is nothing to break down", async () => {
    const summary = { ...EUR, categories: [EUR.categories[0]] };
    mockFetch({ ...LOOKUPS, "GET /api/dashboard/": [200, { ...DASHBOARD, currencies: [summary] }] });
    const { wrapper } = await mountAt("/");
    await wrapper.findAll("[role=group] button")[1].trigger("click");
    await wrapper.findAll("[role=group] button")[0].trigger("click");
    expect(wrapper.find("table").exists()).toBe(true);
    const zero = {
      ...EUR,
      income: "0.00",
      previous_year: { income: "0.00", expenses: "0.00", net: "0.00" },
      categories: [],
    };
    mockFetch({ ...LOOKUPS, "GET /api/dashboard/": [200, { ...DASHBOARD, currencies: [zero] }] });
    const { wrapper: empty } = await mountAt("/");
    expect(empty.text()).toContain("No expenses in this month.");
    expect(empty.find("table").exists()).toBe(false);
    // Without a previous value there is no change to show
    expect(empty.find("[data-change]").exists()).toBe(false);
    await empty.findAll("[role=group] button")[1].trigger("click");
    expect(empty.text()).toContain("No income in this month.");
    await empty.findAll("[role=group] button")[2].trigger("click");
    expect(empty.text()).toContain("No movements in this month.");
  });

  it("shows every currency on its own", async () => {
    const usd = { ...EUR, currency: "USD", categories: [] };
    mockFetch({ ...LOOKUPS, "GET /api/dashboard/": [200, { ...DASHBOARD, currencies: [EUR, usd] }] });
    const { wrapper } = await mountAt("/");
    expect(wrapper.findAll("h2").map((heading) => heading.text())).toEqual([
      "EUR",
      "USD",
      "Balances at the end of November 2026",
    ]);
    expect(tiles(wrapper)[3][1]).toBe("$1,505.00");
  });

  it("moves between months and filters by wallet", async () => {
    const fetch = mockFetch({
      ...LOOKUPS,
      "GET /api/dashboard/": [200, DASHBOARD],
      "GET /api/dashboard/?month=2026-10": [
        200,
        { ...DASHBOARD, month: "2026-10", previous_month: "2026-09", previous_year: "2025-10" },
      ],
      "GET /api/dashboard/?month=2026-11": [200, DASHBOARD],
      "GET /api/dashboard/?month=2027-01": [
        200,
        { ...DASHBOARD, month: "2027-01", previous_month: "2026-12", previous_year: "2026-01" },
      ],
      "GET /api/dashboard/?month=2027-01&wallet=2": [200, { ...DASHBOARD, month: "2027-01", currencies: [] }],
    });
    const { wrapper } = await mountAt("/");
    await wrapper.find("button[name=previous]").trigger("click");
    await flushPromises();
    expect(fetch.mock.lastCall[0]).toBe("/api/dashboard/?month=2026-10");
    expect(wrapper.text()).toContain("October 2026");
    expect(tiles(wrapper)[0][2]).toContain("Oct 2025");

    await wrapper.find("button[name=next]").trigger("click");
    await flushPromises();
    expect(fetch.mock.lastCall[0]).toBe("/api/dashboard/?month=2026-11");

    await wrapper.find("input[name=month]").setValue("2027-01");
    await flushPromises();
    expect(wrapper.text()).toContain("January 2027");

    // Clearing the field keeps the month
    const calls = fetch.mock.calls.length;
    await wrapper.find("input[name=month]").setValue("");
    expect(fetch).toHaveBeenCalledTimes(calls);

    await wrapper.find("select[name=wallet]").setValue("2");
    await flushPromises();
    expect(fetch.mock.lastCall[0]).toBe("/api/dashboard/?month=2027-01&wallet=2");
    expect(wrapper.text()).toContain("No data yet");
  });

  it("asks to create a wallet when there is no data", async () => {
    mockFetch({
      ...LOOKUPS,
      "GET /api/wallets/": [200, []],
      "GET /api/dashboard/": [200, { ...DASHBOARD, currencies: [], wallets: [] }],
    });
    const { wrapper } = await mountAt("/");
    expect(wrapper.text()).toContain("No data yet: add a wallet to get started.");
    expect(wrapper.find("a[href='/wallets/new']").text()).toBe("Create a wallet");
    expect(wrapper.find("ul").exists()).toBe(false);
  });

  it("formats the amounts in the UI language", async () => {
    setLocale("it");
    mockFetch({ ...LOOKUPS, "GET /api/dashboard/": [200, DASHBOARD] });
    const { wrapper } = await mountAt("/");
    expect(wrapper.text()).toContain("novembre 2026");
    expect(tiles(wrapper)[0][0]).toBe("Entrate");
    expect(tiles(wrapper)[0][1]).toBe("1505,00 €");
  });

  it("destroys the chart when leaving the page", async () => {
    mockFetch({ ...LOOKUPS, "GET /api/dashboard/": [200, DASHBOARD], "GET /api/transactions/": [200, page([])] });
    const { wrapper } = await mountAt("/");
    await wrapper.find("header a[href='/transactions']").trigger("click");
    await flushPromises();
    expect(charts[0].destroy).toHaveBeenCalled();
  });

  it("shows a loading message while fetching", async () => {
    mockFetch({ "GET /api/auth/me/": [200, USER] });
    fetch.mockImplementation(async (url) =>
      url === "/api/auth/me/" ? { ok: true, status: 200, json: async () => USER } : new Promise(() => {}),
    );
    const { wrapper } = await mountAt("/");
    expect(wrapper.text()).toContain("Loading…");
  });

  it("shows an error when the categories cannot be loaded", async () => {
    const fetch = mockFetch({ ...LOOKUPS, "GET /api/categories/": [500, {}] });
    const { wrapper } = await mountAt("/");
    expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the dashboard: try again later.");
    expect(fetch).not.toHaveBeenCalledWith("/api/dashboard/", expect.anything());
  });

  it("shows an error when the dashboard cannot be loaded", async () => {
    mockFetch(LOOKUPS);
    const { wrapper } = await mountAt("/");
    expect(wrapper.find("[role=alert]").text()).toBe("Unable to load the dashboard: try again later.");
  });
});
