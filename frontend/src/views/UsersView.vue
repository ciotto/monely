<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { apiFetch } from "@/api/client";

const { locale } = useI18n();
const users = ref(null);
const error = ref(false);

function fullName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || "—";
}

function formatDate(value) {
  return new Date(value).toLocaleString(locale.value, { dateStyle: "medium", timeStyle: "short" });
}

onMounted(async () => {
  try {
    users.value = await apiFetch("/users/");
  } catch {
    error.value = true;
  }
});
</script>

<template>
  <section>
    <h1 class="text-2xl font-semibold">{{ $t("users.title") }}</h1>
    <p v-if="error" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">
      {{ $t("users.error") }}
    </p>
    <p v-else-if="!users" class="mt-6 text-slate-500">{{ $t("users.loading") }}</p>
    <div v-else class="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-500">
          <tr>
            <th class="px-4 py-2 font-medium">{{ $t("users.columns.name") }}</th>
            <th class="px-4 py-2 font-medium">{{ $t("users.columns.email") }}</th>
            <th class="px-4 py-2 font-medium">{{ $t("users.columns.role") }}</th>
            <th class="px-4 py-2 font-medium">{{ $t("users.columns.status") }}</th>
            <th class="px-4 py-2 font-medium">{{ $t("users.columns.lastLogin") }}</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-for="user in users" :key="user.id">
            <td class="px-4 py-2">{{ fullName(user) }}</td>
            <td class="px-4 py-2">{{ user.email }}</td>
            <td class="px-4 py-2">{{ $t(user.is_staff ? "users.roles.admin" : "users.roles.member") }}</td>
            <td class="px-4 py-2" :class="{ 'text-slate-400': !user.is_active }">
              {{ $t(user.is_active ? "users.statuses.active" : "users.statuses.inactive") }}
            </td>
            <td class="px-4 py-2 text-slate-500">
              {{ user.last_login ? formatDate(user.last_login) : $t("users.never") }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
