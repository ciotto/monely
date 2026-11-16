<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { apiFetch } from "@/api/client";
import { formatAmount, formatMonth, today } from "@/format";

// Tells the family balance to reload after a change
const emit = defineEmits(["change"]);
const { t, locale } = useI18n();
// What the family has to transfer to the joint wallets every month, one per currency
const contributions = ref(null);
// Contributions are in the currencies of the wallets, as amounts are never converted
const currencies = ref([]);
const draft = ref({});
// The id of the contribution being edited, if any, with its new values
const editing = ref(null);
const edit = ref({});
// Messages coming from the backend are already translated, the others are i18n keys
const createErrors = ref([]);
const editErrors = ref([]);
const error = ref(null);

function resetDraft() {
  draft.value = { currency: currencies.value[0], amount: "", start_month: today().slice(0, 7) };
}

async function load() {
  contributions.value = await apiFetch("/contributions/");
}

// Runs a write request and reloads the list; the field errors returned by the backend end up in `fieldErrors`
async function write(request, fieldErrors) {
  error.value = null;
  fieldErrors.value = [];
  try {
    await request();
    await load();
    emit("change");
  } catch (e) {
    if (e.status === 400) {
      fieldErrors.value = Object.values(e.data).flat();
    } else {
      error.value = "contributions.errors.save";
    }
    return false;
  }
  return true;
}

async function create() {
  const body = { ...draft.value, amount: String(draft.value.amount) };
  if (await write(() => apiFetch("/contributions/", { method: "POST", body }), createErrors)) {
    resetDraft();
  }
}

function startEdit(contribution) {
  editing.value = contribution.id;
  edit.value = { amount: Number(contribution.amount), start_month: contribution.start_month };
  editErrors.value = [];
}

async function save(contribution) {
  const body = { ...edit.value, amount: String(edit.value.amount) };
  const request = () => apiFetch(`/contributions/${contribution.id}/`, { method: "PATCH", body });
  if (await write(request, editErrors)) {
    editing.value = null;
  }
}

async function remove(contribution) {
  if (!window.confirm(t("contributions.confirmDelete", { currency: contribution.currency }))) {
    return;
  }
  await write(() => apiFetch(`/contributions/${contribution.id}/`, { method: "DELETE" }), editErrors);
}

onMounted(async () => {
  try {
    const wallets = await apiFetch("/wallets/");
    const used = new Set(wallets.map((wallet) => wallet.currency));
    currencies.value = used.size ? [...used].sort() : ["EUR"];
    await load();
  } catch {
    error.value = "contributions.errors.load";
    return;
  }
  resetDraft();
});
</script>

<template>
  <section class="mt-6 rounded-lg border border-slate-200 bg-white p-4">
    <h2 class="font-semibold">{{ $t("contributions.title") }}</h2>
    <p class="mt-1 text-sm text-slate-500">{{ $t("contributions.intro") }}</p>
    <p v-if="error" role="alert" class="mt-4 rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
    <p v-if="!contributions && !error" class="mt-4 text-slate-500">{{ $t("contributions.loading") }}</p>
    <template v-if="contributions">
      <form class="mt-4 flex flex-wrap items-center gap-2" @submit.prevent="create">
        <label v-if="currencies.length > 1">
          <span class="sr-only">{{ $t("contributions.currency") }}</span>
          <select
            v-model="draft.currency"
            name="currency"
            class="block rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
          >
            <option v-for="currency in currencies" :key="currency" :value="currency">{{ currency }}</option>
          </select>
        </label>
        <label class="flex-1">
          <span class="sr-only">{{ $t("contributions.amount") }}</span>
          <input
            v-model="draft.amount"
            type="number"
            name="amount"
            inputmode="decimal"
            min="0"
            step="0.01"
            required
            :placeholder="$t('contributions.amountPlaceholder')"
            class="block w-full rounded border border-slate-300 px-3 py-2 tabular-nums focus:border-brand focus:outline-none"
          />
        </label>
        <label>
          <span class="sr-only">{{ $t("contributions.startMonth") }}</span>
          <input
            v-model="draft.start_month"
            type="month"
            name="start_month"
            required
            class="block rounded border border-slate-300 bg-white px-3 py-2 focus:border-brand focus:outline-none"
          />
        </label>
        <button type="submit" class="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark">
          {{ $t("contributions.add") }}
        </button>
        <span v-for="message in createErrors" :key="message" class="block w-full text-sm text-expense">
          {{ message }}
        </span>
      </form>
      <p
        v-if="!contributions.length"
        class="mt-4 rounded-lg border border-dashed border-slate-300 p-4 text-center text-slate-500"
      >
        {{ $t("contributions.empty") }}
      </p>
      <ul v-else class="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
        <li v-for="contribution in contributions" :key="contribution.id" data-contribution class="px-4 py-3">
          <form
            v-if="editing === contribution.id"
            class="flex flex-wrap items-center gap-3"
            @submit.prevent="save(contribution)"
          >
            <span class="font-medium">{{ contribution.currency }}</span>
            <label>
              <span class="sr-only">{{ $t("contributions.amount") }}</span>
              <input
                v-model="edit.amount"
                type="number"
                name="edit_amount"
                inputmode="decimal"
                min="0"
                step="0.01"
                required
                class="block w-32 rounded border border-slate-300 px-2 py-1 tabular-nums focus:border-brand focus:outline-none"
              />
            </label>
            <label>
              <span class="sr-only">{{ $t("contributions.startMonth") }}</span>
              <input
                v-model="edit.start_month"
                type="month"
                name="edit_start_month"
                required
                class="block rounded border border-slate-300 px-2 py-1 focus:border-brand focus:outline-none"
              />
            </label>
            <button type="submit" class="py-1 text-brand hover:underline">{{ $t("contributions.save") }}</button>
            <button type="button" class="py-1 text-slate-500 hover:underline" @click="editing = null">
              {{ $t("contributions.cancel") }}
            </button>
          </form>
          <div v-else class="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
            <span data-summary>
              {{
                $t("contributions.summary", {
                  amount: formatAmount(contribution.amount, contribution.currency, locale, "auto"),
                  month: formatMonth(contribution.start_month, locale),
                })
              }}
            </span>
            <span class="whitespace-nowrap">
              <button type="button" class="text-brand hover:underline" @click="startEdit(contribution)">
                {{ $t("contributions.edit") }}
              </button>
              <button type="button" class="ml-3 text-expense hover:underline" @click="remove(contribution)">
                {{ $t("contributions.delete") }}
              </button>
            </span>
          </div>
          <span
            v-for="message in editing === contribution.id ? editErrors : []"
            :key="message"
            class="mt-1 block text-sm text-expense"
          >
            {{ message }}
          </span>
        </li>
      </ul>
    </template>
  </section>
</template>
