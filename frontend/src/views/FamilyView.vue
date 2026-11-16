<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";

import { apiFetch } from "@/api/client";
import ContributionSettings from "@/components/ContributionSettings.vue";
import { memberName, transferQuery } from "@/family";
import { addMonths, formatAmount, formatMonth } from "@/format";

const { locale } = useI18n();
const route = useRoute();
// How much each member has to transfer to the joint wallets, by currency: the backend sums what they contributed so far
const balance = ref(null);
// The month can come from the URL, otherwise the backend chooses the current one on the first load
const month = ref(route.query.month ?? null);
const error = ref(null);

async function load() {
  error.value = null;
  try {
    const data = await apiFetch(`/family-balance/${month.value ? `?month=${month.value}` : ""}`);
    month.value = data.month;
    balance.value = data;
  } catch {
    error.value = "family.errors.load";
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

function amount(value, currency) {
  return formatAmount(value, currency, locale.value, "auto");
}

onMounted(load);
</script>

<template>
  <section class="mx-auto max-w-3xl">
    <div class="flex flex-wrap items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">{{ $t("family.title") }}</h1>
      <div v-if="balance" class="flex items-center gap-2 text-sm">
        <button
          type="button"
          name="previous"
          :aria-label="$t('family.previousMonth')"
          class="rounded border border-slate-300 bg-white px-3 py-1 hover:border-brand"
          @click="moveMonth(-1)"
        >
          ‹
        </button>
        <label>
          <span class="sr-only">{{ $t("family.month") }}</span>
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
          :aria-label="$t('family.nextMonth')"
          class="rounded border border-slate-300 bg-white px-3 py-1 hover:border-brand"
          @click="moveMonth(1)"
        >
          ›
        </button>
      </div>
    </div>
    <p class="mt-1 text-sm text-slate-500">{{ $t("family.intro") }}</p>
    <p v-if="error" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
    <p v-if="!balance && !error" class="mt-6 text-slate-500">{{ $t("family.loading") }}</p>
    <template v-if="balance">
      <p
        v-if="!balance.currencies.length"
        class="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500"
      >
        {{ $t("family.empty") }}
      </p>
      <article
        v-for="currency in balance.currencies"
        :key="currency.id"
        data-currency
        class="mt-6 rounded-lg border border-slate-200 bg-white"
      >
        <header class="border-b border-slate-100 px-4 py-3">
          <h2 class="font-semibold">{{ currency.currency }}</h2>
          <p data-summary class="text-sm text-slate-500">
            {{
              $t("family.summary", {
                contribution: amount(currency.amount, currency.currency),
                since: formatMonth(currency.start_month, locale),
                due: amount(currency.due, currency.currency),
                level: amount(currency.level, currency.currency),
              })
            }}
          </p>
          <p data-wallets class="text-sm text-slate-500">
            {{
              currency.wallets.length
                ? $t("family.wallets", { names: currency.wallets.map((wallet) => wallet.name).join(", ") })
                : $t("family.noWallets")
            }}
          </p>
        </header>
        <div class="overflow-x-auto">
          <table class="w-full text-left text-sm">
            <thead class="bg-slate-50 text-slate-500">
              <tr>
                <th class="px-4 py-2 font-medium">{{ $t("family.columns.member") }}</th>
                <th class="px-4 py-2 text-right font-medium">{{ $t("family.columns.transfers") }}</th>
                <th class="px-4 py-2 text-right font-medium">{{ $t("family.columns.sharedExpenses") }}</th>
                <th class="px-4 py-2 text-right font-medium">{{ $t("family.columns.paid") }}</th>
                <th class="px-4 py-2 text-right font-medium">{{ $t("family.columns.suggested") }}</th>
                <th class="px-4 py-2">
                  <span class="sr-only">{{ $t("family.columns.actions") }}</span>
                </th>
              </tr>
            </thead>
            <tbody class="divide-y divide-slate-100">
              <tr v-for="member in currency.members" :key="member.id" data-member>
                <td class="px-4 py-2">{{ memberName(member) }}</td>
                <td class="px-4 py-2 text-right tabular-nums">{{ amount(member.transfers, currency.currency) }}</td>
                <td class="px-4 py-2 text-right tabular-nums">
                  {{ amount(member.shared_expenses, currency.currency) }}
                </td>
                <td class="px-4 py-2 text-right tabular-nums">{{ amount(member.paid, currency.currency) }}</td>
                <td
                  data-suggested
                  class="px-4 py-2 text-right font-semibold tabular-nums"
                  :class="Number(member.suggested) > 0 ? 'text-expense' : 'text-income'"
                >
                  {{ amount(member.suggested, currency.currency) }}
                </td>
                <td class="px-4 py-2 text-right whitespace-nowrap">
                  <RouterLink
                    v-if="Number(member.suggested) > 0"
                    :to="{ name: 'transfer-new', query: transferQuery(currency, member) }"
                    data-transfer
                    class="text-brand hover:underline"
                  >
                    {{ $t("family.transfer") }}
                  </RouterLink>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </article>
    </template>
    <ContributionSettings @change="load" />
  </section>
</template>
