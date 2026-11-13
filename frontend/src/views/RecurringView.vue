<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { apiFetch } from "@/api/client";
import CategoryIcon from "@/components/CategoryIcon.vue";
import { formatAmount, formatDate } from "@/format";

const { t, locale } = useI18n();
// Recurring transactions are not real transactions: they only suggest the ones to register, see the transaction list
const recurring = ref(null);
const walletList = ref([]);
const categoryList = ref([]);
const tagList = ref([]);
const wallets = computed(() => byId(walletList.value));
const categories = computed(() => byId(categoryList.value));
const tags = computed(() => byId(tagList.value));
const error = ref(null);

function byId(list) {
  return Object.fromEntries(list.map((item) => [item.id, item]));
}

async function remove(item) {
  if (!window.confirm(t("recurring.confirmDelete", { description: item.description }))) {
    return;
  }
  error.value = null;
  try {
    await apiFetch(`/recurring-transactions/${item.id}/`, { method: "DELETE" });
    recurring.value = recurring.value.filter((other) => other.id !== item.id);
  } catch {
    error.value = "recurring.errors.delete";
  }
}

onMounted(async () => {
  try {
    [walletList.value, categoryList.value, tagList.value, recurring.value] = await Promise.all([
      apiFetch("/wallets/"),
      apiFetch("/categories/"),
      apiFetch("/tags/"),
      apiFetch("/recurring-transactions/"),
    ]);
  } catch {
    error.value = "recurring.errors.load";
  }
});
</script>

<template>
  <section>
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">{{ $t("recurring.title") }}</h1>
      <RouterLink
        :to="{ name: 'recurring-new' }"
        class="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
      >
        {{ $t("recurring.new") }}
      </RouterLink>
    </div>
    <p class="mt-1 text-sm text-slate-500">{{ $t("recurring.intro") }}</p>
    <p v-if="error" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">
      {{ $t(error) }}
    </p>
    <p v-if="!recurring && !error" class="mt-6 text-slate-500">{{ $t("recurring.loading") }}</p>
    <template v-if="recurring">
      <p
        v-if="!recurring.length"
        class="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500"
      >
        {{ $t("recurring.empty") }}
      </p>
      <div v-else class="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-500">
            <tr>
              <th class="px-4 py-2 font-medium">{{ $t("recurring.columns.nextDate") }}</th>
              <th class="px-4 py-2 font-medium">{{ $t("recurring.columns.description") }}</th>
              <th class="px-4 py-2 font-medium">{{ $t("recurring.columns.category") }}</th>
              <th class="px-4 py-2 font-medium">{{ $t("recurring.columns.wallet") }}</th>
              <th class="px-4 py-2 font-medium">{{ $t("recurring.columns.frequency") }}</th>
              <th class="px-4 py-2 text-right font-medium">{{ $t("recurring.columns.amount") }}</th>
              <th class="px-4 py-2">
                <span class="sr-only">{{ $t("recurring.columns.actions") }}</span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="item in recurring" :key="item.id" :class="{ 'text-slate-400': item.is_ended }">
              <td class="px-4 py-2 whitespace-nowrap">
                {{ item.is_ended ? $t("recurring.ended") : formatDate(item.next_date, locale) }}
              </td>
              <td class="px-4 py-2">
                <span class="block" :title="item.notes">{{ item.description }}</span>
                <span v-if="item.tags.length" class="mt-1 flex flex-wrap gap-1">
                  <span
                    v-for="id in item.tags"
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
                <span v-if="item.category" class="flex items-center gap-2">
                  <CategoryIcon
                    v-if="categories[item.category].icon"
                    :name="categories[item.category].icon"
                    class="size-4 shrink-0"
                    :style="{ color: categories[item.category].color }"
                  />
                  <span
                    v-else
                    class="size-3 shrink-0 rounded-full"
                    :style="{ backgroundColor: categories[item.category].color }"
                  />
                  {{ categories[item.category].name }}
                </span>
              </td>
              <td class="px-4 py-2">{{ wallets[item.wallet].name }}</td>
              <td class="px-4 py-2 whitespace-nowrap">
                {{ $t(`recurring.frequencies.${item.frequency}`, item.interval) }}
              </td>
              <td
                class="px-4 py-2 text-right whitespace-nowrap tabular-nums"
                :class="{
                  'text-expense': !item.is_ended && Number(item.amount) < 0,
                  'text-income': !item.is_ended && Number(item.amount) > 0,
                }"
              >
                {{ formatAmount(item.amount, wallets[item.wallet].currency, locale) }}
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap">
                <RouterLink
                  :to="{ name: 'recurring-edit', params: { id: item.id } }"
                  class="text-brand hover:text-brand-dark"
                >
                  {{ $t("recurring.edit") }}
                </RouterLink>
                <button type="button" class="ml-3 text-expense hover:underline" @click="remove(item)">
                  {{ $t("recurring.delete") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
