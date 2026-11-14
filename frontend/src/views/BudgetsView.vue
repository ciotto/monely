<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import { apiFetch } from "@/api/client";
import BudgetProgress from "@/components/BudgetProgress.vue";
import CategoryIcon from "@/components/CategoryIcon.vue";
import { addMonths, formatAmount } from "@/format";

const { t, locale } = useI18n();
const route = useRoute();
// The budgets of the month, with what their categories spent: the backend spreads the recurring transactions
const summary = ref(null);
const categoryList = ref([]);
const categories = computed(() => Object.fromEntries(categoryList.value.map((item) => [item.id, item])));
// Budgets are in the currencies of the wallets, as amounts are never converted
const currencies = ref([]);
// The month can come from the dashboard, otherwise the backend chooses the current one on the first load
const month = ref(route.query.month ?? null);
const draft = ref({});
// The id of the budget being edited, if any
const editing = ref(null);
const editAmount = ref("");
// Messages coming from the backend are already translated, the others are i18n keys
const createErrors = ref([]);
const editErrors = ref([]);
const error = ref(null);

function resetDraft() {
  draft.value = { category: "", currency: currencies.value[0], amount: "" };
}

async function load() {
  error.value = null;
  try {
    const data = await apiFetch(`/budgets/summary/${month.value ? `?month=${month.value}` : ""}`);
    month.value = data.month;
    summary.value = data;
  } catch {
    error.value = "budgets.errors.load";
  }
}

function moveMonth(months) {
  month.value = addMonths(month.value, months);
  load();
}

function chooseMonth(value) {
  // Clearing the field keeps the current month
  if (value) {
    month.value = value;
    load();
  }
}

// Runs a write request and reloads the month; the field errors returned by the backend end up in `fieldErrors`
async function write(request, fieldErrors) {
  error.value = null;
  fieldErrors.value = [];
  try {
    await request();
  } catch (e) {
    if (e.status === 400) {
      fieldErrors.value = Object.values(e.data).flat();
    } else {
      error.value = "budgets.errors.save";
    }
    return false;
  }
  await load();
  return true;
}

async function create() {
  if (await write(() => apiFetch("/budgets/", { method: "POST", body: draft.value }), createErrors)) {
    resetDraft();
  }
}

function startEdit(budget) {
  editing.value = budget.id;
  editAmount.value = Number(budget.amount);
  editErrors.value = [];
}

async function save(budget) {
  const request = () => apiFetch(`/budgets/${budget.id}/`, { method: "PATCH", body: { amount: editAmount.value } });
  if (await write(request, editErrors)) {
    editing.value = null;
  }
}

async function remove(budget) {
  const name = categories.value[budget.category].name;
  if (!window.confirm(t("budgets.confirmDelete", { name }))) {
    return;
  }
  error.value = null;
  try {
    await apiFetch(`/budgets/${budget.id}/`, { method: "DELETE" });
  } catch {
    error.value = "budgets.errors.delete";
    return;
  }
  await load();
}

function amount(value, currency) {
  return formatAmount(value, currency, locale.value, "auto");
}

onMounted(async () => {
  try {
    const [wallets, categoryItems] = await Promise.all([apiFetch("/wallets/"), apiFetch("/categories/")]);
    categoryList.value = categoryItems;
    const used = new Set(wallets.map((wallet) => wallet.currency));
    currencies.value = used.size ? [...used].sort() : ["EUR"];
  } catch {
    error.value = "budgets.errors.load";
    return;
  }
  resetDraft();
  await load();
});
</script>

<template>
  <section class="mx-auto max-w-2xl">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">{{ $t("budgets.title") }}</h1>
      <div v-if="summary" class="flex items-center gap-2 text-sm">
        <button
          type="button"
          name="previous"
          :aria-label="$t('budgets.previousMonth')"
          class="rounded border border-slate-300 bg-white px-3 py-1 hover:border-brand"
          @click="moveMonth(-1)"
        >
          ‹
        </button>
        <label>
          <span class="sr-only">{{ $t("budgets.month") }}</span>
          <input
            :value="month"
            type="month"
            name="month"
            class="rounded border border-slate-300 bg-white px-2 py-1"
            @change="chooseMonth($event.target.value)"
          />
        </label>
        <button
          type="button"
          name="next"
          :aria-label="$t('budgets.nextMonth')"
          class="rounded border border-slate-300 bg-white px-3 py-1 hover:border-brand"
          @click="moveMonth(1)"
        >
          ›
        </button>
      </div>
    </div>
    <p class="mt-1 text-sm text-slate-500">{{ $t("budgets.intro") }}</p>
    <p v-if="error" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
    <p v-if="!summary && !error" class="mt-6 text-slate-500">{{ $t("budgets.loading") }}</p>
    <template v-if="summary">
      <form class="mt-6 flex flex-wrap items-center gap-2" @submit.prevent="create">
        <label class="flex-1">
          <span class="sr-only">{{ $t("budgets.category") }}</span>
          <select
            v-model="draft.category"
            name="category"
            required
            class="block w-full rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
          >
            <option value="" disabled>{{ $t("budgets.chooseCategory") }}</option>
            <option v-for="category in categoryList" :key="category.id" :value="category.id">
              {{ category.name }}
            </option>
          </select>
        </label>
        <label v-if="currencies.length > 1">
          <span class="sr-only">{{ $t("budgets.currency") }}</span>
          <select
            v-model="draft.currency"
            name="currency"
            class="block rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
          >
            <option v-for="currency in currencies" :key="currency" :value="currency">{{ currency }}</option>
          </select>
        </label>
        <label>
          <span class="sr-only">{{ $t("budgets.amount") }}</span>
          <input
            v-model="draft.amount"
            type="number"
            name="amount"
            inputmode="decimal"
            min="0.01"
            step="0.01"
            required
            :placeholder="$t('budgets.amountPlaceholder')"
            class="block w-36 rounded border border-slate-300 px-3 py-2 tabular-nums focus:border-brand focus:outline-none"
          />
        </label>
        <button type="submit" class="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark">
          {{ $t("budgets.add") }}
        </button>
        <span v-for="message in createErrors" :key="message" class="block w-full text-sm text-expense">
          {{ message }}
        </span>
      </form>
      <p
        v-if="!summary.budgets.length"
        class="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500"
      >
        {{ $t("budgets.empty") }}
      </p>
      <ul v-else class="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
        <li v-for="budget in summary.budgets" :key="budget.id" data-budget class="px-4 py-3">
          <div class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span class="flex items-center gap-2 font-medium">
              <CategoryIcon
                v-if="categories[budget.category].icon"
                :name="categories[budget.category].icon"
                class="size-4 shrink-0"
                :style="{ color: categories[budget.category].color }"
              />
              <span
                v-else
                class="size-3 shrink-0 rounded-full"
                :style="{ backgroundColor: categories[budget.category].color }"
              />
              <span data-name>{{ categories[budget.category].name }}</span>
              <span v-if="currencies.length > 1" class="text-xs font-normal text-slate-500">{{ budget.currency }}</span>
            </span>
            <form v-if="editing === budget.id" class="flex flex-wrap items-center gap-3" @submit.prevent="save(budget)">
              <label>
                <span class="sr-only">{{ $t("budgets.amount") }}</span>
                <input
                  v-model="editAmount"
                  type="number"
                  name="edit_amount"
                  inputmode="decimal"
                  min="0.01"
                  step="0.01"
                  required
                  class="block w-32 rounded border border-slate-300 px-2 py-1 tabular-nums focus:border-brand focus:outline-none"
                />
              </label>
              <button type="submit" class="py-1 text-brand hover:underline">{{ $t("budgets.save") }}</button>
              <button type="button" class="py-1 text-slate-500 hover:underline" @click="editing = null">
                {{ $t("budgets.cancel") }}
              </button>
            </form>
            <span v-else class="whitespace-nowrap">
              <span data-spent class="tabular-nums">
                {{
                  $t("budgets.spentOf", {
                    spent: amount(budget.spent, budget.currency),
                    amount: amount(budget.amount, budget.currency),
                  })
                }}
              </span>
              <button type="button" class="ml-3 text-brand hover:underline" @click="startEdit(budget)">
                {{ $t("budgets.edit") }}
              </button>
              <button type="button" class="ml-3 text-expense hover:underline" @click="remove(budget)">
                {{ $t("budgets.delete") }}
              </button>
            </span>
          </div>
          <span
            v-for="message in editing === budget.id ? editErrors : []"
            :key="message"
            class="mt-1 block text-sm text-expense"
          >
            {{ message }}
          </span>
          <BudgetProgress :budget="budget" :label="categories[budget.category].name" />
        </li>
      </ul>
    </template>
  </section>
</template>
