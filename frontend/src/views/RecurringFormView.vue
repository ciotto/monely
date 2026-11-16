<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import { apiFetch } from "@/api/client";
import { formatDate, today } from "@/format";

const { locale } = useI18n();
const route = useRoute();
const router = useRouter();
// Editing an existing recurring transaction when the route has an id, creating a new one otherwise
const recurringId = route.params.id ? Number(route.params.id) : null;
// Like in the transaction form, the amount is entered without sign and the kind tells expenses from incomes
const form = reactive({
  wallet: "",
  kind: "expense",
  amount: "",
  description: "",
  category: "",
  tags: [],
  notes: "",
  is_shared: false,
  interval: 1,
  frequency: "monthly",
  start_date: today(),
  end_date: "",
});
const wallets = ref([]);
const categories = ref([]);
const tags = ref([]);
// The next occurrence to register, and whether there are no more, of the recurring transaction being edited
const next = ref(null);
const loaded = ref(false);
// Messages coming from the backend are already translated, the others are i18n keys
const fieldErrors = ref({});
const error = ref(null);
const submitting = ref(false);
const title = computed(() => (recurringId === null ? "recurring.form.titleNew" : "recurring.form.titleEdit"));

onMounted(async () => {
  try {
    const [walletList, categoryList, tagList, recurring] = await Promise.all([
      apiFetch("/wallets/"),
      apiFetch("/categories/"),
      apiFetch("/tags/"),
      recurringId === null ? null : apiFetch(`/recurring-transactions/${recurringId}/`),
    ]);
    // Archived wallets do not receive new transactions, but keep the recurring ones they already have
    wallets.value = walletList.filter((wallet) => !wallet.is_archived || wallet.id === recurring?.wallet);
    categories.value = categoryList;
    tags.value = tagList;
    if (recurring) {
      const amount = Number(recurring.amount);
      Object.assign(form, {
        wallet: recurring.wallet,
        kind: amount < 0 ? "expense" : "income",
        amount: Math.abs(amount).toFixed(2),
        description: recurring.description,
        category: recurring.category ?? "",
        tags: recurring.tags,
        notes: recurring.notes,
        is_shared: recurring.is_shared,
        interval: recurring.interval,
        frequency: recurring.frequency,
        start_date: recurring.start_date,
        end_date: recurring.end_date ?? "",
      });
      next.value = { date: recurring.next_date, ended: recurring.is_ended };
    } else if (wallets.value.length === 1) {
      form.wallet = wallets.value[0].id;
    }
    loaded.value = true;
  } catch {
    error.value = "recurring.form.errors.load";
  }
});

async function submit() {
  error.value = null;
  fieldErrors.value = {};
  submitting.value = true;
  const { kind, amount, category, end_date, ...data } = form;
  const body = {
    ...data,
    amount: kind === "expense" ? `-${amount}` : String(amount),
    category: category === "" ? null : category,
    end_date: end_date === "" ? null : end_date,
  };
  try {
    if (recurringId !== null) {
      await apiFetch(`/recurring-transactions/${recurringId}/`, { method: "PATCH", body });
    } else {
      await apiFetch("/recurring-transactions/", { method: "POST", body });
    }
    await router.push({ name: "recurring" });
  } catch (e) {
    if (e.status === 400) {
      fieldErrors.value = e.data;
      error.value = "recurring.form.errors.invalid";
    } else {
      error.value = "recurring.form.errors.generic";
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
      {{ $t("recurring.form.noWallets") }}
      <RouterLink :to="{ name: 'wallet-new' }" class="text-brand hover:text-brand-dark">
        {{ $t("recurring.form.createWallet") }}
      </RouterLink>
    </p>
    <form
      v-else-if="loaded"
      class="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-6"
      @submit.prevent="submit"
    >
      <p v-if="error" role="alert" class="rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
      <fieldset class="grid grid-cols-2 gap-2">
        <legend class="sr-only">{{ $t("recurring.form.fields.kind") }}</legend>
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
      <label class="block">
        <span class="text-sm font-medium">{{ $t("recurring.form.fields.amount") }}</span>
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
        <span class="text-sm font-medium">{{ $t("recurring.form.fields.description") }}</span>
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
      <fieldset>
        <legend class="text-sm font-medium">{{ $t("recurring.form.fields.repeat") }}</legend>
        <div class="mt-1 grid grid-cols-2 gap-4">
          <input
            v-model.number="form.interval"
            type="number"
            name="interval"
            min="1"
            step="1"
            required
            :aria-label="$t('recurring.form.fields.interval')"
            class="block w-full rounded border border-slate-300 px-3 py-2 tabular-nums focus:border-brand focus:outline-none"
          />
          <select
            v-model="form.frequency"
            name="frequency"
            :aria-label="$t('recurring.form.fields.frequency')"
            class="block w-full rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
          >
            <option v-for="frequency in ['weekly', 'monthly', 'yearly']" :key="frequency" :value="frequency">
              {{ $t(`recurring.form.units.${frequency}`, form.interval || 1) }}
            </option>
          </select>
        </div>
        <span
          v-for="message in [...(fieldErrors.interval ?? []), ...(fieldErrors.frequency ?? [])]"
          :key="message"
          class="mt-1 block text-sm text-expense"
        >
          {{ message }}
        </span>
      </fieldset>
      <div class="grid grid-cols-2 gap-4">
        <label class="block">
          <span class="text-sm font-medium">{{ $t("recurring.form.fields.start_date") }}</span>
          <input
            v-model="form.start_date"
            type="date"
            name="start_date"
            required
            class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
          />
          <span v-for="message in fieldErrors.start_date" :key="message" class="mt-1 block text-sm text-expense">
            {{ message }}
          </span>
        </label>
        <label class="block">
          <span class="text-sm font-medium">{{ $t("recurring.form.fields.end_date") }}</span>
          <input
            v-model="form.end_date"
            type="date"
            name="end_date"
            class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
          />
          <span v-for="message in fieldErrors.end_date" :key="message" class="mt-1 block text-sm text-expense">
            {{ message }}
          </span>
        </label>
      </div>
      <p v-if="next" data-next class="text-sm text-slate-500">
        {{
          next.ended ? $t("recurring.form.ended") : $t("recurring.form.next", { date: formatDate(next.date, locale) })
        }}
      </p>
      <label class="block">
        <span class="text-sm font-medium">{{ $t("recurring.form.fields.wallet") }}</span>
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
        <span class="text-sm font-medium">{{ $t("recurring.form.fields.category") }}</span>
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
        <legend class="text-sm font-medium">{{ $t("recurring.form.fields.tags") }}</legend>
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
        <span class="text-sm font-medium">{{ $t("recurring.form.fields.notes") }}</span>
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
          <span class="text-sm font-medium">{{ $t("recurring.form.fields.is_shared") }}</span>
        </span>
        <span class="mt-1 block text-sm text-slate-500">{{ $t("recurring.form.sharedHint") }}</span>
      </label>
      <div class="flex gap-2">
        <button
          type="submit"
          :disabled="submitting"
          class="flex-1 rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {{ $t("recurring.form.save") }}
        </button>
        <RouterLink
          :to="{ name: 'recurring' }"
          class="flex-1 rounded border border-slate-300 px-4 py-2 text-center font-medium hover:border-brand"
        >
          {{ $t("recurring.form.cancel") }}
        </RouterLink>
      </div>
    </form>
  </section>
</template>
