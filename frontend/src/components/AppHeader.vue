<script setup>
import { ChevronDown, CircleUser } from "@lucide/vue";
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";

import { auth, logout } from "@/auth";
import { setLocale, SUPPORTED_LOCALES } from "@/i18n";

const { locale } = useI18n();
const route = useRoute();
const router = useRouter();

// The configuration pages live in the account menu, keeping the bar for the daily ones
const menuOpen = ref(false);
const menu = useTemplateRef("menu");

watch(
  () => route.fullPath,
  () => (menuOpen.value = false),
);

function closeOnOutsideClick(event) {
  if (!menu.value?.contains(event.target)) {
    menuOpen.value = false;
  }
}

function closeOnEscape(event) {
  if (event.key === "Escape") {
    menuOpen.value = false;
  }
}

onMounted(() => {
  document.addEventListener("click", closeOnOutsideClick);
  document.addEventListener("keydown", closeOnEscape);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", closeOnOutsideClick);
  document.removeEventListener("keydown", closeOnEscape);
});

async function signOut() {
  await logout();
  await router.push({ name: "login" });
}
</script>

<template>
  <header class="border-b border-slate-200 bg-white">
    <div class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
      <div class="flex items-center gap-6">
        <RouterLink to="/" class="text-xl font-bold text-brand">Monely</RouterLink>
        <nav v-if="auth.user" class="flex items-center gap-4 text-sm">
          <RouterLink to="/" class="hover:text-brand" active-class="font-semibold text-brand">
            {{ $t("nav.dashboard") }}
          </RouterLink>
          <RouterLink :to="{ name: 'transactions' }" class="hover:text-brand" active-class="font-semibold text-brand">
            {{ $t("nav.transactions") }}
          </RouterLink>
          <RouterLink :to="{ name: 'budgets' }" class="hover:text-brand" active-class="font-semibold text-brand">
            {{ $t("nav.budgets") }}
          </RouterLink>
        </nav>
      </div>
      <div v-if="auth.user" ref="menu" class="relative text-sm">
        <button
          type="button"
          name="menu"
          class="flex items-center gap-2 rounded px-2 py-1 hover:bg-slate-100"
          :class="{ 'text-brand': route.meta.settings }"
          :aria-label="$t('nav.menu')"
          aria-haspopup="true"
          :aria-expanded="menuOpen"
          @click="menuOpen = !menuOpen"
        >
          <CircleUser class="size-5" aria-hidden="true" />
          <span class="hidden text-slate-600 sm:inline">{{ auth.user.email }}</span>
          <ChevronDown class="size-4" aria-hidden="true" />
        </button>
        <div
          v-if="menuOpen"
          class="absolute right-0 z-10 mt-2 w-56 rounded-md border border-slate-200 bg-white py-1 shadow-lg"
        >
          <p class="truncate px-4 py-2 text-xs text-slate-500 sm:hidden">{{ auth.user.email }}</p>
          <p class="px-4 pt-2 pb-1 text-xs font-semibold tracking-wide text-slate-400 uppercase">
            {{ $t("nav.settings") }}
          </p>
          <RouterLink
            :to="{ name: 'wallets' }"
            class="block px-4 py-2 hover:bg-slate-50"
            active-class="font-semibold text-brand"
          >
            {{ $t("nav.wallets") }}
          </RouterLink>
          <RouterLink
            :to="{ name: 'categories' }"
            class="block px-4 py-2 hover:bg-slate-50"
            active-class="font-semibold text-brand"
          >
            {{ $t("nav.categories") }}
          </RouterLink>
          <RouterLink
            :to="{ name: 'tags' }"
            class="block px-4 py-2 hover:bg-slate-50"
            active-class="font-semibold text-brand"
          >
            {{ $t("nav.tags") }}
          </RouterLink>
          <RouterLink
            :to="{ name: 'recurring' }"
            class="block px-4 py-2 hover:bg-slate-50"
            active-class="font-semibold text-brand"
          >
            {{ $t("nav.recurring") }}
          </RouterLink>
          <RouterLink
            v-if="auth.user.is_staff"
            :to="{ name: 'users' }"
            class="block px-4 py-2 hover:bg-slate-50"
            active-class="font-semibold text-brand"
          >
            {{ $t("nav.users") }}
          </RouterLink>
          <RouterLink
            v-if="auth.user.is_staff"
            :to="{ name: 'maintenance' }"
            class="block px-4 py-2 hover:bg-slate-50"
            active-class="font-semibold text-brand"
          >
            {{ $t("nav.maintenance") }}
          </RouterLink>
          <div class="my-1 border-t border-slate-200"></div>
          <label class="flex items-center justify-between px-4 py-2">
            {{ $t("nav.language") }}
            <select
              :value="locale"
              class="rounded border border-slate-300 bg-white px-2 py-1"
              @change="setLocale($event.target.value)"
            >
              <option v-for="code in SUPPORTED_LOCALES" :key="code" :value="code">{{ code.toUpperCase() }}</option>
            </select>
          </label>
          <button
            type="button"
            name="logout"
            class="block w-full px-4 py-2 text-left hover:bg-slate-50"
            @click="signOut"
          >
            {{ $t("nav.logout") }}
          </button>
        </div>
      </div>
      <label v-else class="flex items-center gap-2 text-sm">
        <span class="sr-only">{{ $t("nav.language") }}</span>
        <select
          :value="locale"
          class="rounded border border-slate-300 bg-white px-2 py-1"
          @change="setLocale($event.target.value)"
        >
          <option v-for="code in SUPPORTED_LOCALES" :key="code" :value="code">{{ code.toUpperCase() }}</option>
        </select>
      </label>
    </div>
  </header>
</template>
