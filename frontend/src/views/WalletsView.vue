<script setup>
import { computed, onMounted, ref } from "vue";

import { apiFetch } from "@/api/client";

const wallets = ref(null);
const owners = ref({});
const showArchived = ref(false);
const error = ref(null);
const visibleWallets = computed(() => wallets.value.filter((wallet) => showArchived.value || !wallet.is_archived));

function ownerNames(wallet) {
  return wallet.owners
    .map((id) => owners.value[id])
    .map((owner) => [owner.first_name, owner.last_name].filter(Boolean).join(" ") || owner.email)
    .join(", ");
}

async function toggleArchived(wallet) {
  error.value = null;
  try {
    const updated = await apiFetch(`/wallets/${wallet.id}/`, {
      method: "PATCH",
      body: { is_archived: !wallet.is_archived },
    });
    Object.assign(wallet, updated);
  } catch {
    error.value = "wallets.errors.archive";
  }
}

onMounted(async () => {
  try {
    const [walletList, ownerList] = await Promise.all([apiFetch("/wallets/"), apiFetch("/wallets/owners/")]);
    owners.value = Object.fromEntries(ownerList.map((owner) => [owner.id, owner]));
    wallets.value = walletList;
  } catch {
    error.value = "wallets.errors.load";
  }
});
</script>

<template>
  <section>
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">{{ $t("wallets.title") }}</h1>
      <RouterLink
        :to="{ name: 'wallet-new' }"
        class="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
      >
        {{ $t("wallets.new") }}
      </RouterLink>
    </div>
    <p v-if="error" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">
      {{ $t(error) }}
    </p>
    <p v-if="!wallets && !error" class="mt-6 text-slate-500">{{ $t("wallets.loading") }}</p>
    <template v-if="wallets">
      <label class="mt-6 flex items-center gap-2 text-sm">
        <input v-model="showArchived" type="checkbox" name="show_archived" class="accent-brand" />
        {{ $t("wallets.showArchived") }}
      </label>
      <p
        v-if="!visibleWallets.length"
        class="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500"
      >
        {{ $t("wallets.empty") }}
      </p>
      <div v-else class="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table class="w-full text-left text-sm">
          <thead class="border-b border-slate-200 bg-slate-50 text-slate-500">
            <tr>
              <th class="px-4 py-2 font-medium">{{ $t("wallets.columns.name") }}</th>
              <th class="px-4 py-2 font-medium">{{ $t("wallets.columns.currency") }}</th>
              <th class="px-4 py-2 font-medium">{{ $t("wallets.columns.owners") }}</th>
              <th class="px-4 py-2 font-medium">{{ $t("wallets.columns.status") }}</th>
              <th class="px-4 py-2">
                <span class="sr-only">{{ $t("wallets.columns.actions") }}</span>
              </th>
            </tr>
          </thead>
          <tbody class="divide-y divide-slate-100">
            <tr v-for="wallet in visibleWallets" :key="wallet.id">
              <td class="px-4 py-2">{{ wallet.name }}</td>
              <td class="px-4 py-2">{{ wallet.currency }}</td>
              <td class="px-4 py-2">{{ ownerNames(wallet) }}</td>
              <td class="px-4 py-2" :class="{ 'text-slate-400': wallet.is_archived }">
                {{ $t(wallet.is_archived ? "wallets.statuses.archived" : "wallets.statuses.active") }}
              </td>
              <td class="px-4 py-2 text-right whitespace-nowrap">
                <RouterLink
                  :to="{ name: 'wallet-edit', params: { id: wallet.id } }"
                  class="text-brand hover:text-brand-dark"
                >
                  {{ $t("wallets.edit") }}
                </RouterLink>
                <button type="button" class="ml-3 text-brand hover:underline" @click="toggleArchived(wallet)">
                  {{ $t(wallet.is_archived ? "wallets.restore" : "wallets.archive") }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>
  </section>
</template>
