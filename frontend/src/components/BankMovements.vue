<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { apiFetch } from "@/api/client";
import { formatAmount, formatDate } from "@/format";

// The bank movements that no transaction reconciles (missing), or the ignored ones, of a wallet or of all of them
const props = defineProps({
  status: { type: String, default: "missing" },
  wallet: { type: Number, default: null },
  // The wallets by id, for their names and currencies
  wallets: { type: Object, required: true },
  // Passed to the transaction form, to come back to the same list
  query: { type: Object, default: () => ({}) },
});
// `loaded` passes the movements shown, also after one moves to the other list
const emit = defineEmits(["changed", "loaded"]);
const { locale } = useI18n();
const movements = ref([]);
const error = ref(null);

// Ignoring a missing movement, or restoring an ignored one, moves it to the other list
async function toggle(movement) {
  error.value = null;
  try {
    await apiFetch(`/bank-movements/${movement.id}/`, { method: "PATCH", body: { is_ignored: !movement.is_ignored } });
  } catch {
    error.value = "bankMovements.errors.update";
    return;
  }
  movements.value = movements.value.filter((other) => other.id !== movement.id);
  emit("loaded", movements.value);
  emit("changed");
}

// The list is optional: the pages work without it
onMounted(async () => {
  const params = new URLSearchParams({ status: props.status });
  if (props.wallet !== null) {
    params.set("wallet", props.wallet);
  }
  try {
    movements.value = await apiFetch(`/bank-movements/?${params}`);
  } catch {
    movements.value = [];
  }
  emit("loaded", movements.value);
});
</script>

<template>
  <div v-if="movements.length" :data-movements="status" class="mt-6 rounded-lg border border-brand/30 bg-white p-4">
    <h2 class="font-semibold">{{ $t(`bankMovements.${status}.title`) }}</h2>
    <p class="text-sm text-slate-500">{{ $t(`bankMovements.${status}.intro`) }}</p>
    <p v-if="error" role="alert" class="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
    <ul class="mt-2 divide-y divide-slate-100 text-sm">
      <li v-for="movement in movements" :key="movement.id" class="flex flex-wrap items-center gap-x-4 gap-y-1 py-2">
        <span class="w-28 whitespace-nowrap text-slate-500">{{ formatDate(movement.date, locale) }}</span>
        <span class="min-w-0 flex-1">
          {{ movement.description || $t("bankMovements.noDescription") }}
          <span v-if="wallet === null" class="text-slate-500">· {{ wallets[movement.wallet].name }}</span>
        </span>
        <span
          class="whitespace-nowrap tabular-nums"
          :class="Number(movement.amount) < 0 ? 'text-expense' : 'text-income'"
        >
          {{ formatAmount(movement.amount, wallets[movement.wallet].currency, locale) }}
        </span>
        <span class="whitespace-nowrap">
          <RouterLink
            v-if="status === 'missing'"
            :to="{ name: 'transaction-new', query: { ...query, movement: movement.id } }"
            class="text-brand hover:text-brand-dark"
          >
            {{ $t("bankMovements.register") }}
          </RouterLink>
          <button type="button" name="toggle" class="ml-3 text-slate-500 hover:underline" @click="toggle(movement)">
            {{ $t(`bankMovements.${status}.toggle`) }}
          </button>
        </span>
      </li>
    </ul>
  </div>
</template>
