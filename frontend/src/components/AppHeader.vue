<script setup>
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";

import { auth, logout } from "@/auth";
import { setLocale, SUPPORTED_LOCALES } from "@/i18n";

const { locale } = useI18n();
const router = useRouter();

async function signOut() {
  await logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <header class="border-b border-slate-200 bg-white">
    <div class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
      <RouterLink to="/" class="text-xl font-bold text-brand">Monely</RouterLink>
      <nav class="flex items-center gap-4 text-sm">
        <template v-if="auth.user">
          <RouterLink to="/" class="hover:text-brand" active-class="font-semibold text-brand">
            {{ $t("nav.dashboard") }}
          </RouterLink>
          <RouterLink :to="{ name: 'wallets' }" class="hover:text-brand" active-class="font-semibold text-brand">
            {{ $t("nav.wallets") }}
          </RouterLink>
          <RouterLink :to="{ name: 'categories' }" class="hover:text-brand" active-class="font-semibold text-brand">
            {{ $t("nav.categories") }}
          </RouterLink>
          <RouterLink :to="{ name: 'tags' }" class="hover:text-brand" active-class="font-semibold text-brand">
            {{ $t("nav.tags") }}
          </RouterLink>
          <RouterLink
            v-if="auth.user.is_staff"
            :to="{ name: 'users' }"
            class="hover:text-brand"
            active-class="font-semibold text-brand"
          >
            {{ $t("nav.users") }}
          </RouterLink>
          <span class="text-slate-500">{{ auth.user.email }}</span>
          <button type="button" class="hover:text-brand" @click="signOut">{{ $t("nav.logout") }}</button>
        </template>
        <label class="flex items-center gap-2">
          <span class="sr-only">{{ $t("nav.language") }}</span>
          <select
            :value="locale"
            class="rounded border border-slate-300 bg-white px-2 py-1"
            @change="setLocale($event.target.value)"
          >
            <option v-for="code in SUPPORTED_LOCALES" :key="code" :value="code">{{ code.toUpperCase() }}</option>
          </select>
        </label>
      </nav>
    </div>
  </header>
</template>
