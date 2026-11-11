<script setup>
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";

import { apiFetch } from "@/api/client";
import { auth } from "@/auth";

const { locale, t } = useI18n();
const users = ref(null);
const error = ref(null);

function fullName(user) {
  return [user.first_name, user.last_name].filter(Boolean).join(" ") || "—";
}

function formatDate(value) {
  return new Date(value).toLocaleString(locale.value, { dateStyle: "medium", timeStyle: "short" });
}

async function remove(user) {
  if (!window.confirm(t("users.confirmDelete", { email: user.email }))) {
    return;
  }
  error.value = null;
  try {
    await apiFetch(`/users/${user.id}/`, { method: "DELETE" });
    users.value = users.value.filter((other) => other.id !== user.id);
  } catch {
    error.value = "users.errors.delete";
  }
}

onMounted(async () => {
  try {
    users.value = await apiFetch("/users/");
  } catch {
    error.value = "users.errors.load";
  }
});
</script>

<template>
  <section>
    <div class="flex items-center justify-between gap-4">
      <h1 class="text-2xl font-semibold">{{ $t("users.title") }}</h1>
      <RouterLink
        :to="{ name: 'user-new' }"
        class="rounded bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark"
      >
        {{ $t("users.new") }}
      </RouterLink>
    </div>
    <p v-if="error" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">
      {{ $t(error) }}
    </p>
    <p v-if="!users && !error" class="mt-6 text-slate-500">{{ $t("users.loading") }}</p>
    <div v-if="users" class="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white">
      <table class="w-full text-left text-sm">
        <thead class="border-b border-slate-200 bg-slate-50 text-slate-500">
          <tr>
            <th class="px-4 py-2 font-medium">{{ $t("users.columns.name") }}</th>
            <th class="px-4 py-2 font-medium">{{ $t("users.columns.email") }}</th>
            <th class="px-4 py-2 font-medium">{{ $t("users.columns.role") }}</th>
            <th class="px-4 py-2 font-medium">{{ $t("users.columns.status") }}</th>
            <th class="px-4 py-2 font-medium">{{ $t("users.columns.lastLogin") }}</th>
            <th class="px-4 py-2">
              <span class="sr-only">{{ $t("users.columns.actions") }}</span>
            </th>
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
            <td class="px-4 py-2 text-right whitespace-nowrap">
              <RouterLink :to="{ name: 'user-edit', params: { id: user.id } }" class="text-brand hover:text-brand-dark">
                {{ $t("users.edit") }}
              </RouterLink>
              <button
                v-if="user.id !== auth.user.id"
                type="button"
                class="ml-3 text-expense hover:underline"
                @click="remove(user)"
              >
                {{ $t("users.delete") }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
