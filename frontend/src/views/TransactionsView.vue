<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { apiFetch } from "@/api/client";
import CategoryIcon from "@/components/CategoryIcon.vue";
import { formatAmount, formatDate } from "@/format";

const { t, locale } = useI18n();
const transactions = ref(null);
// The lists keep the backend order (by name), the maps by id show the names of the related objects
const walletList = ref([]);
const categoryList = ref([]);
const tagList = ref([]);
const wallets = computed(() => byId(walletList.value));
const categories = computed(() => byId(categoryList.value));
const tags = computed(() => byId(tagList.value));
// Empty values do not filter
const filters = reactive({ wallet: "", category: "", tag: "", date_from: "", date_to: "" });
// The query string of the filters, shared by the list and the export
const query = computed(() => {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== "")).toString();
  return params ? `?${params}` : "";
});
const error = ref(null);
const filterErrors = ref([]);
// The counts of the created objects after an import, or the errors of the rejected file
const imported = ref(null);
const importErrors = ref([]);
const importing = ref(false);

function byId(list) {
  return Object.fromEntries(list.map((item) => [item.id, item]));
}

async function loadTransactions() {
  error.value = null;
  filterErrors.value = [];
  try {
    transactions.value = await apiFetch(`/transactions/${query.value}`);
  } catch (e) {
    // e.g. an end date before the start date
    if (e.status === 400) {
      filterErrors.value = Object.values(e.data).flat();
    } else {
      error.value = "transactions.errors.load";
    }
  }
}

async function remove(transaction) {
  if (!window.confirm(t("transactions.confirmDelete", { description: transaction.description }))) {
    return;
  }
  error.value = null;
  try {
    await apiFetch(`/transactions/${transaction.id}/`, { method: "DELETE" });
    transactions.value = transactions.value.filter((other) => other.id !== transaction.id);
  } catch {
    error.value = "transactions.errors.delete";
  }
}

async function load() {
  try {
    [walletList.value, categoryList.value, tagList.value] = await Promise.all([
      apiFetch("/wallets/"),
      apiFetch("/categories/"),
      apiFetch("/tags/"),
    ]);
  } catch {
    error.value = "transactions.errors.load";
    return;
  }
  await loadTransactions();
}

async function importFile(event) {
  const [file] = event.target.files;
  // Lets the same file be chosen again, e.g. after fixing it
  event.target.value = "";
  error.value = null;
  imported.value = null;
  importErrors.value = [];
  importing.value = true;
  const body = new FormData();
  body.append("file", file);
  try {
    imported.value = await apiFetch("/transactions/import/", { method: "POST", body });
  } catch (e) {
    // e.g. the invalid rows of the file
    if (e.status === 400) {
      importErrors.value = Object.values(e.data).flat();
    } else {
      error.value = "transactions.errors.import";
    }
    return;
  } finally {
    importing.value = false;
  }
  // The import can also create wallets, categories and tags
  await load();
}

watch(filters, loadTransactions);

onMounted(load);
</script>

<template>
  <section>
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">{{ $t("transactions.title") }}</h1>
      <div class="flex flex-wrap items-center justify-end gap-2 text-sm font-medium">
        <a
          :href="`/api/transactions/export/${query}`"
          download
          class="rounded border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50"
        >
          {{ $t("transactions.export") }}
        </a>
        <label
          class="cursor-pointer rounded border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50 has-disabled:cursor-wait has-disabled:opacity-60"
        >
          {{ $t(importing ? "transactions.importing" : "transactions.import") }}
          <input
            type="file"
            name="import"
            accept=".csv,text/csv"
            class="sr-only"
            :disabled="importing"
            @change="importFile"
          />
        </label>
        <RouterLink :to="{ name: 'transaction-new' }" class="rounded bg-brand px-4 py-2 text-white hover:bg-brand-dark">
          {{ $t("transactions.new") }}
        </RouterLink>
      </div>
    </div>
    <p v-if="error" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">
      {{ $t(error) }}
    </p>
    <div v-if="importErrors.length" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">
      <p class="font-medium">{{ $t("transactions.importFailed") }}</p>
      <ul class="mt-1 list-disc pl-5">
        <li v-for="message in importErrors" :key="message">{{ message }}</li>
      </ul>
    </div>
    <p v-if="imported" role="status" class="mt-6 rounded bg-green-50 px-3 py-2 text-sm text-income">
      {{ $t("transactions.imported", imported.transactions) }}
      <template v-if="imported.wallets || imported.categories || imported.tags">
        {{ $t("transactions.importCreated", imported) }}
      </template>
    </p>
    <p v-if="!transactions && !error && !filterErrors.length" class="mt-6 text-slate-500">
      {{ $t("transactions.loading") }}
    </p>
    <div role="search" class="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
      <label>
        <span class="block text-slate-500">{{ $t("transactions.filters.wallet") }}</span>
        <select
          v-model="filters.wallet"
          name="wallet"
          class="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
        >
          <option value="">{{ $t("transactions.filters.all") }}</option>
          <option v-for="wallet in walletList" :key="wallet.id" :value="wallet.id">{{ wallet.name }}</option>
        </select>
      </label>
      <label>
        <span class="block text-slate-500">{{ $t("transactions.filters.category") }}</span>
        <select
          v-model="filters.category"
          name="category"
          class="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
        >
          <option value="">{{ $t("transactions.filters.all") }}</option>
          <option v-for="category in categoryList" :key="category.id" :value="category.id">
            {{ category.name }}
          </option>
        </select>
      </label>
      <label>
        <span class="block text-slate-500">{{ $t("transactions.filters.tag") }}</span>
        <select v-model="filters.tag" name="tag" class="mt-1 block w-full rounded border border-slate-300 px-2 py-1">
          <option value="">{{ $t("transactions.filters.all") }}</option>
          <option v-for="tag in tagList" :key="tag.id" :value="tag.id">{{ tag.name }}</option>
        </select>
      </label>
      <label>
        <span class="block text-slate-500">{{ $t("transactions.filters.dateFrom") }}</span>
        <input
          v-model="filters.date_from"
          type="date"
          name="date_from"
          class="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
        />
      </label>
      <label>
        <span class="block text-slate-500">{{ $t("transactions.filters.dateTo") }}</span>
        <input
          v-model="filters.date_to"
          type="date"
          name="date_to"
          class="mt-1 block w-full rounded border border-slate-300 px-2 py-1"
        />
      </label>
      <span v-for="message in filterErrors" :key="message" class="col-span-full block text-expense">
        {{ message }}
      </span>
    </div>
    <template v-if="transactions">
      <p
        v-if="!transactions.length"
        class="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500"
      >
        {{ $t("transactions.empty") }}
      </p>
      <div v-else class="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-500">
            <tr>
              <th class="px-4 py-2 font-medium">{{ $t("transactions.columns.date") }}</th>
              <th class="px-4 py-2 font-medium">{{ $t("transactions.columns.description") }}</th>
              <th class="px-4 py-2 font-medium">{{ $t("transactions.columns.category") }}</th>
              <th class="px-4 py-2 font-medium">{{ $t("transactions.columns.wallet") }}</th>
              <th class="px-4 py-2 text-right font-medium">{{ $t("transactions.columns.amount") }}</th>
              <th class="px-4 py-2">
                <span class="sr-only">{{ $t("transactions.columns.actions") }}</span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="transaction in transactions" :key="transaction.id">
              <td class="px-4 py-2 whitespace-nowrap">{{ formatDate(transaction.date, locale) }}</td>
              <td class="px-4 py-2">
                <span class="block" :title="transaction.notes">{{ transaction.description }}</span>
                <span v-if="transaction.tags.length" class="mt-1 flex flex-wrap gap-1">
                  <span
                    v-for="id in transaction.tags"
                    :key="id"
                    data-tag
                    class="rounded-full px-2 text-xs text-white"
                    :style="{ backgroundColor: tags[id].color }"
                  >
                    {{ tags[id].name }}
                  </span>
                </span>
              </td>
              <td class="px-4 py-2">
                <span v-if="transaction.category" class="flex items-center gap-2">
                  <CategoryIcon
                    v-if="categories[transaction.category].icon"
                    :name="categories[transaction.category].icon"
                    class="size-4 shrink-0"
                    :style="{ color: categories[transaction.category].color }"
                  />
                  <span
                    v-else
                    class="size-3 shrink-0 rounded-full"
                    :style="{ backgroundColor: categories[transaction.category].color }"
                  />
                  {{ categories[transaction.category].name }}
                </span>
              </td>
              <td class="px-4 py-2">{{ wallets[transaction.wallet].name }}</td>
              <td
                class="px-4 py-2 text-right whitespace-nowrap tabular-nums"
                :class="Number(transaction.amount) < 0 ? 'text-expense' : 'text-income'"
              >
                {{ formatAmount(transaction.amount, wallets[transaction.wallet].currency, locale) }}
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap">
                <RouterLink
                  :to="{ name: 'transaction-edit', params: { id: transaction.id } }"
                  class="text-brand hover:text-brand-dark"
                >
                  {{ $t("transactions.edit") }}
                </RouterLink>
                <button type="button" class="ml-3 text-expense hover:underline" @click="remove(transaction)">
                  {{ $t("transactions.delete") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
