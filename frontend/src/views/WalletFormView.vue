<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { apiFetch } from "@/api/client";
import { auth } from "@/auth";

const route = useRoute();
const router = useRouter();
// Editing an existing wallet when the route has an id, creating a new one otherwise
const walletId = route.params.id ? Number(route.params.id) : null;
// New wallets belong to the current user unless chosen otherwise
const form = reactive({
  name: "",
  currency: "EUR",
  // A personal wallet has a single owner; a joint one belongs to the whole family and receives its contributions
  owner: auth.user.id,
  is_shared: false,
  is_archived: false,
});
// How to read the bank statements: the columns are found by their header, the amount is either a signed column or the
// difference between an income and an expense column
const importEnabled = ref(false);
const importFormat = reactive({
  date_column: "",
  date_format: "%d/%m/%Y",
  amount_column: "",
  income_column: "",
  expense_column: "",
  description_column: "",
  decimal_separator: ",",
  delimiter: ";",
  negate_amounts: false,
});
const amountMode = ref("signed");
// The formats show an example date, the same in every language
const DATE_FORMATS = {
  "%d/%m/%Y": "31/12/2026",
  "%d/%m/%y": "31/12/26",
  "%d-%m-%Y": "31-12-2026",
  "%d.%m.%Y": "31.12.2026",
  "%Y-%m-%d": "2026-12-31",
  "%m/%d/%Y": "12/31/2026",
};
const DELIMITERS = { ";": "semicolon", ",": "comma", "\t": "tab" };
const owners = ref([]);
const loaded = ref(false);
// Messages coming from the backend are already translated, the others are i18n keys
const fieldErrors = ref({});
const error = ref(null);
const submitting = ref(false);
const title = computed(() => (walletId === null ? "wallets.form.titleNew" : "wallets.form.titleEdit"));

function ownerName(owner) {
  return [owner.first_name, owner.last_name].filter(Boolean).join(" ") || owner.email;
}

onMounted(async () => {
  try {
    const [ownerList, wallet] = await Promise.all([
      apiFetch("/wallets/owners/"),
      walletId === null ? null : apiFetch(`/wallets/${walletId}/`),
    ]);
    owners.value = ownerList;
    if (wallet) {
      for (const field of ["name", "currency", "is_archived", "is_shared"]) {
        form[field] = wallet[field];
      }
      // A joint wallet has no owner: the current user is proposed if it becomes personal
      form.owner = wallet.owners[0] ?? auth.user.id;
      if (wallet.import_format) {
        importEnabled.value = true;
        Object.assign(importFormat, wallet.import_format);
        amountMode.value = wallet.import_format.amount_column ? "signed" : "split";
      }
    }
    loaded.value = true;
  } catch {
    error.value = "wallets.form.errors.load";
  }
});

async function submit() {
  error.value = null;
  fieldErrors.value = {};
  submitting.value = true;
  const { currency, owner, ...data } = form;
  data.owners = data.is_shared ? [] : [owner];
  // Only the columns of the chosen kind of amount are kept
  const columns = amountMode.value === "signed" ? { income_column: "", expense_column: "" } : { amount_column: "" };
  data.import_format = importEnabled.value ? { ...importFormat, ...columns } : null;
  try {
    // The currency cannot be changed once the wallet exists
    if (walletId !== null) {
      await apiFetch(`/wallets/${walletId}/`, { method: "PATCH", body: data });
    } else {
      await apiFetch("/wallets/", { method: "POST", body: { ...data, currency: currency.toUpperCase() } });
    }
    await router.push({ name: "wallets" });
  } catch (e) {
    if (e.status === 400) {
      fieldErrors.value = e.data;
      error.value = "wallets.form.errors.invalid";
    } else {
      error.value = "wallets.form.errors.generic";
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
    <form v-if="loaded" class="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-6" @submit.prevent="submit">
      <p v-if="error" role="alert" class="rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
      <label class="block">
        <span class="text-sm font-medium">{{ $t("wallets.form.fields.name") }}</span>
        <input
          v-model="form.name"
          type="text"
          name="name"
          autocomplete="off"
          maxlength="100"
          required
          class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
        <span v-for="message in fieldErrors.name" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </label>
      <label class="block">
        <span class="text-sm font-medium">{{ $t("wallets.form.fields.currency") }}</span>
        <input
          v-model="form.currency"
          type="text"
          name="currency"
          autocomplete="off"
          minlength="3"
          maxlength="3"
          required
          :disabled="walletId !== null"
          class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 uppercase focus:border-brand focus:outline-none disabled:bg-slate-50 disabled:text-slate-500"
        />
        <span class="mt-1 block text-sm text-slate-500">
          {{ $t(walletId === null ? "wallets.form.currencyHint" : "wallets.form.currencyFixed") }}
        </span>
        <span v-for="message in fieldErrors.currency" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </label>
      <label class="flex items-center gap-2">
        <input v-model="form.is_shared" type="checkbox" name="is_shared" class="accent-brand" />
        <span class="text-sm font-medium">{{ $t("wallets.form.fields.is_shared") }}</span>
      </label>
      <p v-if="form.is_shared" class="text-sm text-slate-500">{{ $t("wallets.form.sharedHint") }}</p>
      <fieldset v-else>
        <legend class="text-sm font-medium">{{ $t("wallets.form.fields.owner") }}</legend>
        <label v-for="owner in owners" :key="owner.id" class="mt-1 flex items-center gap-2 text-sm">
          <input v-model="form.owner" type="radio" name="owner" :value="owner.id" class="accent-brand" />
          {{ ownerName(owner) }}
        </label>
        <span v-for="message in fieldErrors.owners" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </fieldset>
      <fieldset class="space-y-4 border-t border-slate-200 pt-4">
        <legend class="sr-only">{{ $t("wallets.form.import.title") }}</legend>
        <label class="block">
          <span class="flex items-center gap-2">
            <input v-model="importEnabled" type="checkbox" name="import_enabled" class="accent-brand" />
            <span class="text-sm font-medium">{{ $t("wallets.form.import.enabled") }}</span>
          </span>
          <span class="mt-1 block text-sm text-slate-500">{{ $t("wallets.form.import.hint") }}</span>
        </label>
        <template v-if="importEnabled">
          <div class="grid grid-cols-2 gap-4">
            <label class="block">
              <span class="text-sm font-medium">{{ $t("wallets.form.import.date_column") }}</span>
              <input
                v-model="importFormat.date_column"
                type="text"
                name="date_column"
                autocomplete="off"
                maxlength="100"
                required
                class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
              />
              <span
                v-for="message in fieldErrors.import_format?.date_column"
                :key="message"
                class="mt-1 block text-sm text-expense"
              >
                {{ message }}
              </span>
            </label>
            <label class="block">
              <span class="text-sm font-medium">{{ $t("wallets.form.import.date_format") }}</span>
              <select
                v-model="importFormat.date_format"
                name="date_format"
                class="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
              >
                <option v-for="(example, value) in DATE_FORMATS" :key="value" :value="value">{{ example }}</option>
              </select>
            </label>
          </div>
          <fieldset>
            <legend class="text-sm font-medium">{{ $t("wallets.form.import.amount") }}</legend>
            <label v-for="mode in ['signed', 'split']" :key="mode" class="mt-1 flex items-center gap-2 text-sm">
              <input v-model="amountMode" type="radio" name="amount_mode" :value="mode" class="accent-brand" />
              {{ $t(`wallets.form.import.amountModes.${mode}`) }}
            </label>
          </fieldset>
          <label v-if="amountMode === 'signed'" class="block">
            <span class="text-sm font-medium">{{ $t("wallets.form.import.amount_column") }}</span>
            <input
              v-model="importFormat.amount_column"
              type="text"
              name="amount_column"
              autocomplete="off"
              maxlength="100"
              required
              class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
            />
            <span
              v-for="message in fieldErrors.import_format?.amount_column"
              :key="message"
              class="mt-1 block text-sm text-expense"
            >
              {{ message }}
            </span>
          </label>
          <div v-else class="grid grid-cols-2 gap-4">
            <label v-for="column in ['income_column', 'expense_column']" :key="column" class="block">
              <span class="text-sm font-medium">{{ $t(`wallets.form.import.${column}`) }}</span>
              <input
                v-model="importFormat[column]"
                type="text"
                :name="column"
                autocomplete="off"
                maxlength="100"
                required
                class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
              />
            </label>
            <span
              v-for="message in fieldErrors.import_format?.amount_column"
              :key="message"
              class="col-span-2 block text-sm text-expense"
            >
              {{ message }}
            </span>
          </div>
          <label class="block">
            <span class="text-sm font-medium">{{ $t("wallets.form.import.description_column") }}</span>
            <input
              v-model="importFormat.description_column"
              type="text"
              name="description_column"
              autocomplete="off"
              maxlength="100"
              class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
            />
            <span class="mt-1 block text-sm text-slate-500">{{ $t("wallets.form.import.optional") }}</span>
          </label>
          <div class="grid grid-cols-2 gap-4">
            <label class="block">
              <span class="text-sm font-medium">{{ $t("wallets.form.import.decimal_separator") }}</span>
              <select
                v-model="importFormat.decimal_separator"
                name="decimal_separator"
                class="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
              >
                <option value=",">{{ $t("wallets.form.import.separators.comma") }}</option>
                <option value=".">{{ $t("wallets.form.import.separators.dot") }}</option>
              </select>
            </label>
            <label class="block">
              <span class="text-sm font-medium">{{ $t("wallets.form.import.delimiter") }}</span>
              <select
                v-model="importFormat.delimiter"
                name="delimiter"
                class="mt-1 block w-full rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
              >
                <option v-for="(name, value) in DELIMITERS" :key="name" :value="value">
                  {{ $t(`wallets.form.import.delimiters.${name}`) }}
                </option>
              </select>
            </label>
          </div>
          <label class="block">
            <span class="flex items-center gap-2">
              <input v-model="importFormat.negate_amounts" type="checkbox" name="negate_amounts" class="accent-brand" />
              <span class="text-sm font-medium">{{ $t("wallets.form.import.negate_amounts") }}</span>
            </span>
            <span class="mt-1 block text-sm text-slate-500">{{ $t("wallets.form.import.negateHint") }}</span>
          </label>
        </template>
      </fieldset>
      <label v-if="walletId !== null" class="flex items-center gap-2">
        <input v-model="form.is_archived" type="checkbox" name="is_archived" class="accent-brand" />
        <span class="text-sm font-medium">{{ $t("wallets.form.fields.is_archived") }}</span>
      </label>
      <div class="flex gap-2">
        <button
          type="submit"
          :disabled="submitting"
          class="flex-1 rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {{ $t("wallets.form.save") }}
        </button>
        <RouterLink
          :to="{ name: 'wallets' }"
          class="flex-1 rounded border border-slate-300 px-4 py-2 text-center font-medium hover:border-brand"
        >
          {{ $t("wallets.form.cancel") }}
        </RouterLink>
      </div>
    </form>
  </section>
</template>
