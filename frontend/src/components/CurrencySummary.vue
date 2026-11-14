<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";

import BarChart from "@/components/BarChart.vue";
import CategoryIcon from "@/components/CategoryIcon.vue";
import { formatAmount, formatMonth } from "@/format";

// The month of one currency: the totals are compared with the same month of the previous year, the categories also
// with the previous month. In the expenses, the categories with a budget show how much of it the month used
const props = defineProps({
  summary: { type: Object, required: true },
  month: { type: String, required: true },
  previousMonth: { type: String, required: true },
  previousYear: { type: String, required: true },
  // The categories by id
  categories: { type: Object, required: true },
  showCurrency: { type: Boolean, default: false },
});

const { t, locale } = useI18n();
// The breakdown shows the expenses, the incomes or their sum
const kind = ref("expenses");
// The budgets by category, with what they spent: the recurring transactions count with their monthly share
const budgets = computed(() => Object.fromEntries(props.summary.budgets.map((budget) => [budget.category, budget])));
const showBudgets = computed(() => kind.value === "expenses" && props.summary.budgets.length > 0);

// The current month stands out in the brand color, the previous periods are context
const periods = computed(() => [
  { prefix: "", month: props.month, color: "#0f766e" },
  { prefix: "previous_month_", month: props.previousMonth, color: "#d97706" },
  { prefix: "previous_year_", month: props.previousYear, color: "#94a3b8" },
]);

// Expenses are negative: the tiles and the chart show their magnitude, the net keeps its sign
const tiles = computed(() =>
  ["income", "expenses", "net"].map((key) => {
    const value = (amount) => (key === "net" ? Number(amount) : Math.abs(amount));
    const current = value(props.summary[key]);
    const previous = value(props.summary.previous_year[key]);
    return {
      key,
      current,
      previous,
      change: previous === 0 ? null : (current - previous) / Math.abs(previous),
      signDisplay: key === "net" ? "exceptZero" : "auto",
    };
  }),
);

function categoryValue(row, prefix) {
  if (kind.value === "net") {
    // Summed in cents, as the floating point sum of two amounts can lose them
    return Math.round((Number(row[`${prefix}income`]) + Number(row[`${prefix}expenses`])) * 100) / 100;
  }
  return Math.abs(row[`${prefix}${kind.value}`]);
}

// The biggest amounts come first, the current month deciding over the previous periods
function byMagnitude(a, b) {
  for (const [index, value] of b.values.entries()) {
    const difference = Math.abs(value) - Math.abs(a.values[index]);
    if (difference) {
      return difference;
    }
  }
  return 0;
}

const rows = computed(() => {
  const source = [...props.summary.categories];
  if (showBudgets.value) {
    // A category with a budget is shown also without transactions, e.g. when only recurring transactions weigh on it
    const listed = new Set(source.map((row) => row.category));
    for (const budget of props.summary.budgets.filter((budget) => !listed.has(budget.category))) {
      const empty = periods.value.flatMap(({ prefix }) => [`${prefix}income`, `${prefix}expenses`]);
      source.push({ category: budget.category, ...Object.fromEntries(empty.map((field) => [field, "0.00"])) });
    }
  }
  return source
    .map((row) => {
      const budget = showBudgets.value ? budgets.value[row.category] : undefined;
      const values = periods.value.map(({ prefix }) => categoryValue(row, prefix));
      if (budget) {
        // Refunds above the expenses use none of the budget
        values[0] = Math.max(Number(budget.spent), 0);
      }
      return { category: row.category === null ? null : props.categories[row.category], budget, values };
    })
    .filter((row) => row.budget || row.values.some(Boolean))
    .sort(byMagnitude);
});

const labels = computed(() => rows.value.map((row) => row.category?.name ?? t("dashboard.uncategorized")));
const datasets = computed(() => {
  const [current, ...previous] = periods.value.map((period, index) => ({
    label: formatMonth(period.month, locale.value, "short"),
    data: rows.value.map((row) => row.values[index]),
    backgroundColor: period.color,
  }));
  if (!showBudgets.value) {
    return [current, ...previous];
  }
  // The bar of the month stacks what is left of the budget, or what goes over it, on what it spent
  // Rounded to cents, as the floating point difference of two amounts can lose them
  const budgetPart = (part) =>
    rows.value.map((row) =>
      row.budget ? Math.round(part(row.values[0], Number(row.budget.amount)) * 100) / 100 : null,
    );
  return [
    {
      ...current,
      data: rows.value.map((row) => Math.min(row.values[0], Number(row.budget?.amount ?? Infinity))),
      stack: "current",
    },
    {
      label: t("dashboard.budgetLeft"),
      data: budgetPart((spent, amount) => Math.max(amount - spent, 0)),
      backgroundColor: "#99f6e4",
      stack: "current",
    },
    {
      label: t("dashboard.overBudget"),
      data: budgetPart((spent, amount) => Math.max(spent - amount, 0)),
      backgroundColor: "#b91c1c",
      stack: "current",
    },
    ...previous,
  ];
});
const signDisplay = computed(() => (kind.value === "net" ? "exceptZero" : "auto"));

function amount(value, signDisplay = "auto") {
  return formatAmount(value, props.summary.currency, locale.value, signDisplay);
}

// The axis has few, round values: the cents would only crowd it
function axisAmount(value) {
  return new Intl.NumberFormat(locale.value, {
    style: "currency",
    currency: props.summary.currency,
    maximumFractionDigits: 0,
  }).format(value);
}

function percentage(change) {
  return new Intl.NumberFormat(locale.value, {
    style: "percent",
    maximumFractionDigits: 0,
    signDisplay: "exceptZero",
  }).format(change);
}
</script>

<template>
  <section class="mt-6">
    <h2 v-if="showCurrency" class="text-lg font-semibold">{{ summary.currency }}</h2>
    <div class="mt-2 grid gap-4 sm:grid-cols-3">
      <div v-for="tile in tiles" :key="tile.key" data-tile class="rounded-lg border border-slate-200 bg-white p-4">
        <p class="text-sm text-slate-500">{{ $t(`dashboard.tiles.${tile.key}`) }}</p>
        <p class="mt-1 text-2xl font-semibold tabular-nums">{{ amount(tile.current, tile.signDisplay) }}</p>
        <p class="mt-1 text-sm text-slate-500 tabular-nums">
          {{ formatMonth(previousYear, locale, "short") }}: {{ amount(tile.previous, tile.signDisplay) }}
          <span v-if="tile.change !== null" data-change>({{ percentage(tile.change) }})</span>
        </p>
      </div>
    </div>
    <div class="mt-4 rounded-lg border border-slate-200 bg-white p-4">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <h3 class="font-semibold">{{ $t("dashboard.byCategory") }}</h3>
        <div role="group" :aria-label="$t('dashboard.kind')" class="flex rounded border border-slate-300 text-sm">
          <button
            v-for="option in ['expenses', 'income', 'net']"
            :key="option"
            type="button"
            :aria-pressed="kind === option"
            class="px-3 py-1"
            :class="kind === option ? 'bg-brand text-white' : 'hover:text-brand'"
            @click="kind = option"
          >
            {{ $t(`dashboard.kinds.${option}`) }}
          </button>
        </div>
      </div>
      <p v-if="!rows.length" class="mt-4 text-center text-sm text-slate-500">
        {{ $t(`dashboard.noData.${kind}`) }}
      </p>
      <template v-else>
        <BarChart
          class="mt-2"
          :labels="labels"
          :datasets="datasets"
          :format="(value) => amount(value, signDisplay)"
          :format-axis="axisAmount"
          :label="$t(`dashboard.chartLabel.${kind}`)"
        />
        <div class="mt-4 overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="border-b border-slate-200 text-slate-500">
              <tr>
                <th class="py-2 font-medium">{{ $t("dashboard.columns.category") }}</th>
                <th
                  v-for="period in periods"
                  :key="period.prefix"
                  class="py-2 pl-2 text-right font-medium whitespace-nowrap"
                >
                  {{ formatMonth(period.month, locale, "short") }}
                </th>
                <th v-if="showBudgets" class="py-2 pl-2 text-right font-medium">
                  {{ $t("dashboard.columns.budget") }}
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="(row, index) in rows" :key="row.category?.id ?? 'none'">
                <td class="py-2">
                  <span class="flex items-center gap-2">
                    <CategoryIcon
                      v-if="row.category?.icon"
                      :name="row.category.icon"
                      class="size-4 shrink-0"
                      :style="{ color: row.category.color }"
                    />
                    <span
                      v-else
                      class="size-3 shrink-0 rounded-full"
                      :style="{ backgroundColor: row.category?.color ?? '#cbd5e1' }"
                    />
                    {{ labels[index] }}
                  </span>
                </td>
                <td
                  v-for="(value, period) in row.values"
                  :key="period"
                  class="py-2 pl-2 text-right whitespace-nowrap tabular-nums"
                  :class="{ 'text-slate-500': period > 0 }"
                >
                  {{ amount(value, signDisplay) }}
                </td>
                <td v-if="showBudgets" data-budget class="py-2 pl-2 text-right whitespace-nowrap tabular-nums">
                  <template v-if="row.budget">
                    {{ amount(row.budget.amount) }}
                    <span
                      class="block text-xs"
                      :class="Number(row.budget.remaining) < 0 ? 'font-medium text-expense' : 'text-slate-500'"
                    >
                      {{
                        Number(row.budget.remaining) < 0
                          ? $t("budgets.over", { amount: amount(-row.budget.remaining) })
                          : $t("budgets.remaining", { amount: amount(row.budget.remaining) })
                      }}
                    </span>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p v-if="showBudgets" data-budget-note class="mt-3 text-sm text-slate-500">
          {{ $t("dashboard.budgetNote") }}
          <RouterLink :to="{ name: 'budgets', query: { month } }" class="text-brand hover:text-brand-dark">
            {{ $t("dashboard.manageBudgets") }}
          </RouterLink>
        </p>
      </template>
    </div>
  </section>
</template>
