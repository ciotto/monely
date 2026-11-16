<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import { apiFetch } from "@/api/client";
import { formatDate, today } from "@/format";

const { locale } = useI18n();
const route = useRoute();
const router = useRouter();
// Editing an existing transaction when the route has an id, creating a new one otherwise
const transactionId = route.params.id ? Number(route.params.id) : null;
// A new transaction can register the next occurrence of a recurring transaction, which fills the form
const recurringId = transactionId === null && route.query.recurring ? Number(route.query.recurring) : null;
const recurringDate = ref(null);
// Or a bank movement that no transaction reconciles yet, which fills the form as well
const movementId = transactionId === null && route.query.movement ? Number(route.query.movement) : null;
const movementDate = ref(null);
// Back to the list with the filters it was opened from
const listQuery = Object.fromEntries(
  Object.entries(route.query).filter(([name]) => !["recurring", "movement"].includes(name)),
);
// The amount is entered without sign: the kind tells expenses (negative) from incomes (positive)
const form = reactive({
  wallet: "",
  kind: "expense",
  amount: "",
  date: today(),
  description: "",
  category: "",
  tags: [],
  notes: "",
  is_shared: false,
});
const wallets = ref([]);
const categories = ref([]);
const tags = ref([]);
const loaded = ref(false);
// Messages coming from the backend are already translated, the others are i18n keys
const fieldErrors = ref({});
const error = ref(null);
const submitting = ref(false);
const title = computed(() => (transactionId === null ? "transactions.form.titleNew" : "transactions.form.titleEdit"));

onMounted(async () => {
  try {
    const [walletList, categoryList, tagList, transaction, recurring, movement] = await Promise.all([
      apiFetch("/wallets/"),
      apiFetch("/categories/"),
      apiFetch("/tags/"),
      transactionId === null ? null : apiFetch(`/transactions/${transactionId}/`),
      recurringId === null ? null : apiFetch(`/recurring-transactions/${recurringId}/`),
      movementId === null ? null : apiFetch(`/bank-movements/${movementId}/`),
    ]);
    // Archived wallets do not receive new transactions, but keep the ones they already have
    wallets.value = walletList.filter((wallet) => !wallet.is_archived || wallet.id === transaction?.wallet);
    categories.value = categoryList;
    tags.value = tagList;
    // The occurrence of a recurring transaction is due on its next date
    // The movement has only the fields written by the bank
    const source =
      transaction ??
      (recurring && { ...recurring, date: recurring.next_date }) ??
      (movement && { ...movement, category: null, tags: [], notes: "", is_shared: false });
    recurringDate.value = recurring?.next_date ?? null;
    movementDate.value = movement?.date ?? null;
    if (source) {
      const amount = Number(source.amount);
      Object.assign(form, {
        wallet: source.wallet,
        kind: amount < 0 ? "expense" : "income",
        amount: Math.abs(amount).toFixed(2),
        date: source.date,
        description: source.description,
        category: source.category ?? "",
        tags: source.tags,
        notes: source.notes,
        is_shared: source.is_shared,
      });
    } else if (wallets.value.length === 1) {
      form.wallet = wallets.value[0].id;
    }
    loaded.value = true;
  } catch {
    error.value = "transactions.form.errors.load";
  }
});

async function submit() {
  error.value = null;
  fieldErrors.value = {};
  submitting.value = true;
  const { kind, amount, category, ...data } = form;
  const body = {
    ...data,
    amount: kind === "expense" ? `-${amount}` : String(amount),
    category: category === "" ? null : category,
  };
  if (recurringId !== null) {
    body.recurring_transaction = recurringId;
  }
  try {
    if (transactionId !== null) {
      await apiFetch(`/transactions/${transactionId}/`, { method: "PATCH", body });
    } else {
      await apiFetch("/transactions/", { method: "POST", body });
    }
    await router.push({ name: "transactions", query: listQuery });
  } catch (e) {
    if (e.status === 400) {
      fieldErrors.value = e.data;
      error.value = "transactions.form.errors.invalid";
    } else {
      error.value = "transactions.form.errors.generic";
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
      v-if="loaded && !wallets.length"
      class="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500"
    >
      {{ $t("transactions.form.noWallets") }}
      <RouterLink :to="{ name: 'wallet-new' }" class="text-brand hover:text-brand-dark">
        {{ $t("transactions.form.createWallet") }}
      </RouterLink>
    </p>
    <form
      v-else-if="loaded"
      class="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-6"
      @submit.prevent="submit"
    >
      <p v-if="error" role="alert" class="rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
      <p v-if="recurringDate" data-recurring class="text-sm text-slate-500">
        {{ $t("transactions.form.fromRecurring", { date: formatDate(recurringDate, locale) }) }}
      </p>
      <p v-if="movementDate" data-movement class="text-sm text-slate-500">
        {{ $t("transactions.form.fromMovement", { date: formatDate(movementDate, locale) }) }}
      </p>
      <fieldset class="grid grid-cols-2 gap-2">
        <legend class="sr-only">{{ $t("transactions.form.fields.kind") }}</legend>
        <label
          v-for="kind in ['expense', 'income']"
          :key="kind"
          class="flex cursor-pointer items-center justify-center gap-2 rounded border px-3 py-2 text-sm font-medium"
          :class="
            form.kind === kind
              ? kind === 'expense'
                ? 'border-expense bg-red-50 text-expense'
                : 'border-income bg-green-50 text-income'
              : 'border-slate-300'
          "
        >
          <input v-model="form.kind" type="radio" name="kind" :value="kind" class="sr-only" />
          {{ $t(`transactions.form.kinds.${kind}`) }}
        </label>
      </fieldset>
      <div class="grid grid-cols-2 gap-4">
        <label class="block">
          <span class="text-sm font-medium">{{ $t("transactions.form.fields.amount") }}</span>
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
          <span class="text-sm font-medium">{{ $t("transactions.form.fields.date") }}</span>
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
        <span class="text-sm font-medium">{{ $t("transactions.form.fields.description") }}</span>
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
        <span class="text-sm font-medium">{{ $t("transactions.form.fields.wallet") }}</span>
        <select
          v-model="form.wallet"
          name="wallet"
          required
          class="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
        >
          <option value="" disabled>{{ $t("transactions.form.chooseWallet") }}</option>
          <option v-for="wallet in wallets" :key="wallet.id" :value="wallet.id">
            {{ wallet.name }} ({{ wallet.currency }})
          </option>
        </select>
        <span v-for="message in fieldErrors.wallet" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </label>
      <label class="block">
        <span class="text-sm font-medium">{{ $t("transactions.form.fields.category") }}</span>
        <select
          v-model="form.category"
          name="category"
          class="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
        >
          <option value="">{{ $t("transactions.form.noCategory") }}</option>
          <option v-for="category in categories" :key="category.id" :value="category.id">{{ category.name }}</option>
        </select>
        <span v-for="message in fieldErrors.category" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </label>
      <fieldset>
        <legend class="text-sm font-medium">{{ $t("transactions.form.fields.tags") }}</legend>
        <p v-if="!tags.length" class="mt-1 text-sm text-slate-500">{{ $t("transactions.form.noTags") }}</p>
        <div v-else class="mt-1 flex flex-wrap gap-2">
          <label
            v-for="tag in tags"
            :key="tag.id"
            class="flex cursor-pointer items-center gap-1 rounded-full border px-3 py-1 text-sm"
            :style="form.tags.includes(tag.id) ? { backgroundColor: tag.color, borderColor: tag.color } : {}"
            :class="form.tags.includes(tag.id) ? 'text-white' : 'border-slate-300'"
          >
            <input v-model="form.tags" type="checkbox" name="tags" :value="tag.id" class="sr-only" />
            {{ tag.name }}
          </label>
        </div>
        <span v-for="message in fieldErrors.tags" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </fieldset>
      <label class="block">
        <span class="text-sm font-medium">{{ $t("transactions.form.fields.notes") }}</span>
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
      <label class="block">
        <span class="flex items-center gap-2">
          <input v-model="form.is_shared" type="checkbox" name="is_shared" class="accent-brand" />
          <span class="text-sm font-medium">{{ $t("transactions.form.fields.is_shared") }}</span>
        </span>
        <span class="mt-1 block text-sm text-slate-500">{{ $t("transactions.form.sharedHint") }}</span>
      </label>
      <div class="flex gap-2">
        <button
          type="submit"
          :disabled="submitting"
          class="flex-1 rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {{ $t("transactions.form.save") }}
        </button>
        <RouterLink
          :to="{ name: 'transactions', query: listQuery }"
          class="flex-1 rounded border border-slate-300 px-4 py-2 text-center font-medium hover:border-brand"
        >
          {{ $t("transactions.form.cancel") }}
        </RouterLink>
      </div>
    </form>
  </section>
</template>
