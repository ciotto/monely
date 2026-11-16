<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";

import { apiFetch } from "@/api/client";
import BankMovements from "@/components/BankMovements.vue";

const route = useRoute();
const walletId = Number(route.params.id);
const wallet = ref(null);
const wallets = computed(() => ({ [walletId]: wallet.value }));
const error = ref(null);
// The counts of the new and of the already imported movements, or the errors of the rejected file
const imported = ref(null);
const importErrors = ref([]);
const importing = ref(false);
// Changes after an import, or when a movement moves between the lists, to load them again
const version = ref(0);

async function importFile(event) {
  const [file] = event.target.files;
  // Lets the same file be chosen again, e.g. after fixing the import format
  event.target.value = "";
  error.value = null;
  imported.value = null;
  importErrors.value = [];
  importing.value = true;
  const body = new FormData();
  body.append("file", file);
  try {
    imported.value = await apiFetch(`/wallets/${walletId}/import/`, { method: "POST", body });
    version.value += 1;
  } catch (e) {
    // e.g. the columns of the import format are not in the file
    if (e.status === 400) {
      importErrors.value = Object.values(e.data).flat();
    } else {
      error.value = "bankImport.errors.import";
    }
  } finally {
    importing.value = false;
  }
}

onMounted(async () => {
  try {
    wallet.value = await apiFetch(`/wallets/${walletId}/`);
  } catch {
    error.value = "bankImport.errors.load";
  }
});
</script>

<template>
  <section>
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">
        {{ $t("bankImport.title") }}<template v-if="wallet"> · {{ wallet.name }}</template>
      </h1>
      <label
        v-if="wallet?.import_format"
        class="cursor-pointer rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark has-disabled:cursor-wait has-disabled:opacity-60"
      >
        {{ $t(importing ? "bankImport.importing" : "bankImport.import") }}
        <input
          type="file"
          name="statement"
          accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          class="sr-only"
          :disabled="importing"
          @change="importFile"
        />
      </label>
    </div>
    <p v-if="error" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
    <template v-if="wallet">
      <p
        v-if="!wallet.import_format"
        class="mt-6 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500"
      >
        {{ $t("bankImport.noFormat") }}
        <RouterLink :to="{ name: 'wallet-edit', params: { id: walletId } }" class="text-brand hover:text-brand-dark">
          {{ $t("bankImport.setUpFormat") }}
        </RouterLink>
      </p>
      <template v-else>
        <p class="mt-2 text-sm text-slate-500">{{ $t("bankImport.intro") }}</p>
        <div v-if="importErrors.length" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">
          <p class="font-medium">{{ $t("bankImport.importFailed") }}</p>
          <ul class="mt-1 list-disc pl-5">
            <li v-for="message in importErrors" :key="message">{{ message }}</li>
          </ul>
        </div>
        <p v-if="imported" role="status" class="mt-6 rounded bg-green-50 px-3 py-2 text-sm text-income">
          {{ $t("bankImport.imported", imported.imported) }}
          <template v-if="imported.duplicates">{{ $t("bankImport.duplicates", imported.duplicates) }}</template>
        </p>
        <BankMovements
          :key="`missing-${version}`"
          status="missing"
          :wallet="walletId"
          :wallets="wallets"
          @changed="version += 1"
        />
        <BankMovements
          :key="`ignored-${version}`"
          status="ignored"
          :wallet="walletId"
          :wallets="wallets"
          @changed="version += 1"
        />
      </template>
    </template>
  </section>
</template>
