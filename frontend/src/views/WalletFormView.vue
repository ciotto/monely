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
const form = reactive({ name: "", currency: "EUR", owners: [auth.user.id], is_archived: false });
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
      for (const field of ["name", "currency", "owners", "is_archived"]) {
        form[field] = wallet[field];
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
  if (!form.owners.length) {
    error.value = "wallets.form.errors.noOwners";
    return;
  }
  submitting.value = true;
  const { currency, ...data } = form;
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
      <fieldset>
        <legend class="text-sm font-medium">{{ $t("wallets.form.fields.owners") }}</legend>
        <label v-for="owner in owners" :key="owner.id" class="mt-1 flex items-center gap-2 text-sm">
          <input v-model="form.owners" type="checkbox" name="owners" :value="owner.id" class="accent-brand" />
          {{ ownerName(owner) }}
        </label>
        <span v-for="message in fieldErrors.owners" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
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
