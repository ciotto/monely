<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import { apiFetch } from "@/api/client";
import { today } from "@/format";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
// Editing an existing transfer when the route has an id, creating a new one otherwise
const transferId = route.params.id ? Number(route.params.id) : null;
// The amount is positive: it leaves the first wallet and enters the second one
const form = reactive({
  from_wallet: "",
  to_wallet: "",
  amount: "",
  date: today(),
  description: "",
  notes: "",
});
const wallets = ref([]);
const loaded = ref(false);
// Messages coming from the backend are already translated, the others are i18n keys
const fieldErrors = ref({});
const error = ref(null);
const submitting = ref(false);
const title = computed(() => (transferId === null ? "transfers.form.titleNew" : "transfers.form.titleEdit"));
// Amounts are never converted, so the money can only move to another wallet with the same currency
const destinations = computed(() => {
  const source = wallets.value.find((wallet) => wallet.id === form.from_wallet);
  return wallets.value.filter((wallet) => wallet !== source && (!source || wallet.currency === source.currency));
});

watch(destinations, (options) => {
  if (!options.some((wallet) => wallet.id === form.to_wallet)) {
    form.to_wallet = "";
  }
});

onMounted(async () => {
  try {
    const [walletList, transfer] = await Promise.all([
      apiFetch("/wallets/"),
      transferId === null ? null : apiFetch(`/transfers/${transferId}/`),
    ]);
    // Archived wallets do not receive new transfers, but keep the ones they already have
    const current = transfer ? [transfer.from_wallet, transfer.to_wallet] : [];
    wallets.value = walletList.filter((wallet) => !wallet.is_archived || current.includes(wallet.id));
    if (transfer) {
      Object.assign(form, {
        from_wallet: transfer.from_wallet,
        to_wallet: transfer.to_wallet,
        amount: transfer.amount,
        date: transfer.date,
        description: transfer.description,
        notes: transfer.notes,
      });
    } else {
      form.description = t("transfers.form.defaultDescription");
    }
    loaded.value = true;
  } catch {
    error.value = "transfers.form.errors.load";
  }
});

async function submit() {
  error.value = null;
  fieldErrors.value = {};
  submitting.value = true;
  const body = { ...form, amount: String(form.amount) };
  try {
    if (transferId !== null) {
      await apiFetch(`/transfers/${transferId}/`, { method: "PATCH", body });
    } else {
      await apiFetch("/transfers/", { method: "POST", body });
    }
    await router.push({ name: "transactions" });
  } catch (e) {
    if (e.status === 400) {
      fieldErrors.value = e.data;
      error.value = "transfers.form.errors.invalid";
    } else {
      error.value = "transfers.form.errors.generic";
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="mx-auto max-w-md">
    <h1 class="text-2xl font-semibold">{{ $t(title) }}</h1>
    <p v-if="error && !loaded" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">
      {{ $t(error) }}
    </p>
    <p
      v-if="loaded && wallets.length < 2"
      class="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500"
    >
      {{ $t("transfers.form.noWallets") }}
      <RouterLink :to="{ name: 'wallet-new' }" class="text-brand hover:text-brand-dark">
        {{ $t("transfers.form.createWallet") }}
      </RouterLink>
    </p>
    <form
      v-else-if="loaded"
      class="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-6"
      @submit.prevent="submit"
    >
      <p v-if="error" role="alert" class="rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
      <label class="block">
        <span class="text-sm font-medium">{{ $t("transfers.form.fields.from_wallet") }}</span>
        <select
          v-model="form.from_wallet"
          name="from_wallet"
          required
          class="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
        >
          <option value="" disabled>{{ $t("transfers.form.chooseWallet") }}</option>
          <option v-for="wallet in wallets" :key="wallet.id" :value="wallet.id">
            {{ wallet.name }} ({{ wallet.currency }})
          </option>
        </select>
        <span v-for="message in fieldErrors.from_wallet" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </label>
      <label class="block">
        <span class="text-sm font-medium">{{ $t("transfers.form.fields.to_wallet") }}</span>
        <select
          v-model="form.to_wallet"
          name="to_wallet"
          required
          class="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
        >
          <option value="" disabled>{{ $t("transfers.form.chooseWallet") }}</option>
          <option v-for="wallet in destinations" :key="wallet.id" :value="wallet.id">
            {{ wallet.name }} ({{ wallet.currency }})
          </option>
        </select>
        <span v-for="message in fieldErrors.to_wallet" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </label>
      <div class="grid grid-cols-2 gap-4">
        <label class="block">
          <span class="text-sm font-medium">{{ $t("transfers.form.fields.amount") }}</span>
          <input
            v-model="form.amount"
            type="number"
            name="amount"
            inputmode="decimal"
            min="0.01"
            step="0.01"
            required
            class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 tabular-nums focus:border-brand focus:outline-none"
          />
          <span v-for="message in fieldErrors.amount" :key="message" class="mt-1 block text-sm text-expense">
            {{ message }}
          </span>
        </label>
        <label class="block">
          <span class="text-sm font-medium">{{ $t("transfers.form.fields.date") }}</span>
          <input
            v-model="form.date"
            type="date"
            name="date"
            required
            class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
          />
          <span v-for="message in fieldErrors.date" :key="message" class="mt-1 block text-sm text-expense">
            {{ message }}
          </span>
        </label>
      </div>
      <label class="block">
        <span class="text-sm font-medium">{{ $t("transfers.form.fields.description") }}</span>
        <input
          v-model="form.description"
          type="text"
          name="description"
          autocomplete="off"
          maxlength="200"
          required
          class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
        <span v-for="message in fieldErrors.description" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </label>
      <label class="block">
        <span class="text-sm font-medium">{{ $t("transfers.form.fields.notes") }}</span>
        <textarea
          v-model="form.notes"
          name="notes"
          rows="3"
          class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
        <span v-for="message in fieldErrors.notes" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </label>
      <div class="flex gap-2">
        <button
          type="submit"
          :disabled="submitting"
          class="flex-1 rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {{ $t("transfers.form.save") }}
        </button>
        <RouterLink
          :to="{ name: 'transactions' }"
          class="flex-1 rounded border border-slate-300 px-4 py-2 text-center font-medium hover:border-brand"
        >
          {{ $t("transfers.form.cancel") }}
        </RouterLink>
      </div>
    </form>
  </section>
</template>
