<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { apiFetch } from "@/api/client";
import CurrencySummary from "@/components/CurrencySummary.vue";
import { addMonths, formatAmount, formatMonth } from "@/format";

const { locale } = useI18n();
const dashboard = ref(null);
const wallets = ref([]);
const categories = ref({});
// The backend chooses the current month on the first load
const month = ref(null);
const wallet = ref("");
const error = ref(null);
const monthLabel = computed(() => formatMonth(dashboard.value.month, locale.value));

async function load() {
  error.value = null;
  const query = new URLSearchParams();
  if (month.value) {
    query.set("month", month.value);
  }
  if (wallet.value !== "") {
    query.set("wallet", wallet.value);
  }
  try {
    const data = await apiFetch(`/dashboard/${query.size ? `?${query}` : ""}`);
    month.value = data.month;
    dashboard.value = data;
  } catch {
    error.value = "dashboard.errors.load";
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

onMounted(async () => {
  try {
    const [walletList, categoryList] = await Promise.all([apiFetch("/wallets/"), apiFetch("/categories/")]);
    // Archived wallets are not offered, but their transactions still count in the totals
    wallets.value = walletList.filter((item) => !item.is_archived);
    categories.value = Object.fromEntries(categoryList.map((category) => [category.id, category]));
  } catch {
    error.value = "dashboard.errors.load";
    return;
  }
  await load();
});
</script>

<template>
  <section>
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">{{ $t("dashboard.title") }}</h1>
      <div v-if="dashboard" class="flex flex-wrap items-center gap-2 text-sm">
        <button
          type="button"
          name="previous"
          :aria-label="$t('dashboard.previousMonth')"
          class="rounded border border-slate-300 bg-white px-3 py-1 hover:border-brand"
          @click="moveMonth(-1)"
        >
          ‹
        </button>
        <label>
          <span class="sr-only">{{ $t("dashboard.month") }}</span>
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
          :aria-label="$t('dashboard.nextMonth')"
          class="rounded border border-slate-300 bg-white px-3 py-1 hover:border-brand"
          @click="moveMonth(1)"
        >
          ›
        </button>
        <label>
          <span class="sr-only">{{ $t("dashboard.wallet") }}</span>
          <select
            v-model="wallet"
            name="wallet"
            class="rounded border border-slate-300 bg-white px-2 py-1"
            @change="load"
          >
            <option value="">{{ $t("dashboard.allWallets") }}</option>
            <option v-for="item in wallets" :key="item.id" :value="item.id">{{ item.name }}</option>
          </select>
        </label>
      </div>
    </div>
    <p v-if="error" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
    <p v-if="!dashboard && !error" class="mt-6 text-slate-500">{{ $t("dashboard.loading") }}</p>
    <template v-if="dashboard">
      <div
        v-if="!dashboard.currencies.length"
        class="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500"
      >
        {{ $t("dashboard.empty") }}
        <RouterLink :to="{ name: 'wallet-new' }" class="text-brand hover:text-brand-dark">
          {{ $t("dashboard.createWallet") }}
        </RouterLink>
      </div>
      <CurrencySummary
        v-for="summary in dashboard.currencies"
        :key="summary.currency"
        :summary="summary"
        :month="dashboard.month"
        :previous-month="dashboard.previous_month"
        :previous-year="dashboard.previous_year"
        :categories="categories"
        :show-currency="dashboard.currencies.length > 1"
      />
      <div v-if="dashboard.wallets.length" class="mt-6 rounded-lg border border-slate-200 bg-white p-4">
        <h2 class="font-semibold">{{ $t("dashboard.balances", { month: monthLabel }) }}</h2>
        <ul class="mt-2 divide-y divide-slate-100 text-sm">
          <li v-for="item in dashboard.wallets" :key="item.id" class="flex justify-between gap-4 py-2">
            <span>{{ item.name }}</span>
            <span class="tabular-nums">{{ formatAmount(item.balance, item.currency, locale, "auto") }}</span>
          </li>
        </ul>
      </div>
    </template>
  </section>
</template>
