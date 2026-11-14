<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";

import { formatAmount } from "@/format";

// How much of a budget its category spent in the month: the bar, the breakdown and the recurring transactions
const props = defineProps({
  budget: { type: Object, required: true },
  // The name of the category, which labels the bar
  label: { type: String, required: true },
});

const { locale } = useI18n();
const over = computed(() => Number(props.budget.remaining) < 0);
// The share of the budget already spent, from 0 to 100: refunds can make it negative
const progress = computed(
  () => Math.min(Math.max(Number(props.budget.spent) / Number(props.budget.amount), 0), 1) * 100,
);

function amount(value) {
  return formatAmount(value, props.budget.currency, locale.value, "auto");
}
</script>

<template>
  <div>
    <div
      role="progressbar"
      :aria-label="label"
      aria-valuemin="0"
      aria-valuemax="100"
      :aria-valuenow="Math.round(progress)"
      class="mt-2 h-2 overflow-hidden rounded-full bg-slate-100"
    >
      <div class="h-full rounded-full" :class="over ? 'bg-expense' : 'bg-brand'" :style="{ width: `${progress}%` }" />
    </div>
    <div class="mt-1 flex flex-wrap justify-between gap-x-4 text-slate-500">
      <span data-breakdown class="tabular-nums">
        {{
          $t("budgets.breakdown", { transactions: amount(budget.transactions), recurring: amount(budget.recurring) })
        }}
      </span>
      <span data-remaining class="tabular-nums" :class="{ 'font-medium text-expense': over }">
        {{
          over
            ? $t("budgets.over", { amount: amount(-budget.remaining) })
            : $t("budgets.remaining", { amount: amount(budget.remaining) })
        }}
      </span>
    </div>
    <ul v-if="budget.recurring_transactions.length" data-recurring class="mt-1 text-xs text-slate-500">
      <li v-for="item in budget.recurring_transactions" :key="item.id" class="flex justify-between gap-4">
        <span>{{ item.description }}</span>
        <span class="tabular-nums">{{ $t("budgets.perMonth", { amount: amount(item.share) }) }}</span>
      </li>
    </ul>
  </div>
</template>
