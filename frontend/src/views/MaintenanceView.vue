<script setup>
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { apiFetch } from "@/api/client";

const { t } = useI18n();
// The technical tools for the admins, one card each
const counts = ref(null);
const error = ref(null);
// The deletion is confirmed by typing a word, in the UI language
const confirmation = ref("");
const deleting = ref(false);
const deleted = ref(null);
const confirmed = computed(() => confirmation.value.trim() === t("maintenance.deleteData.confirmWord"));
const hasData = computed(() => Object.values(counts.value).some(Boolean));

async function deleteData() {
  error.value = null;
  deleted.value = null;
  deleting.value = true;
  try {
    deleted.value = await apiFetch("/maintenance/data/", { method: "DELETE" });
    counts.value = Object.fromEntries(Object.keys(counts.value).map((name) => [name, 0]));
    confirmation.value = "";
  } catch {
    error.value = "maintenance.deleteData.errors.delete";
  } finally {
    deleting.value = false;
  }
}

onMounted(async () => {
  try {
    counts.value = await apiFetch("/maintenance/data/");
  } catch {
    error.value = "maintenance.errors.load";
  }
});
</script>

<template>
  <section class="mx-auto max-w-2xl">
    <h1 class="text-2xl font-semibold">{{ $t("maintenance.title") }}</h1>
    <p class="mt-1 text-sm text-slate-500">{{ $t("maintenance.intro") }}</p>
    <p v-if="error" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
    <p v-if="!counts && !error" class="mt-6 text-slate-500">{{ $t("maintenance.loading") }}</p>
    <div v-if="counts" class="mt-6 rounded-lg border border-red-200 bg-white p-6">
      <h2 class="text-lg font-semibold text-expense">{{ $t("maintenance.deleteData.title") }}</h2>
      <p class="mt-2 text-sm">{{ $t("maintenance.deleteData.description") }}</p>
      <ul data-counts class="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
        <li v-for="(count, name) in counts" :key="name" class="rounded bg-slate-50 px-3 py-2">
          <span class="block text-lg font-semibold tabular-nums">{{ count }}</span>
          <span class="text-slate-500">{{ $t(`maintenance.deleteData.counts.${name}`) }}</span>
        </li>
      </ul>
      <p v-if="deleted" role="status" class="mt-4 rounded bg-green-50 px-3 py-2 text-sm text-income">
        {{ $t("maintenance.deleteData.done", deleted) }}
      </p>
      <p v-if="!hasData" class="mt-4 text-sm text-slate-500">{{ $t("maintenance.deleteData.empty") }}</p>
      <form v-else class="mt-4 space-y-3" @submit.prevent="deleteData">
        <label class="block">
          <span class="text-sm font-medium">
            {{ $t("maintenance.deleteData.confirm", { word: $t("maintenance.deleteData.confirmWord") }) }}
          </span>
          <input
            v-model="confirmation"
            type="text"
            name="confirmation"
            autocomplete="off"
            class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-expense focus:outline-none"
          />
        </label>
        <button
          type="submit"
          :disabled="!confirmed || deleting"
          class="rounded bg-expense px-4 py-2 font-medium text-white hover:opacity-90 disabled:opacity-50"
        >
          {{ $t(deleting ? "maintenance.deleteData.deleting" : "maintenance.deleteData.submit") }}
        </button>
      </form>
    </div>
  </section>
</template>
