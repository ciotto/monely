<script setup>
import { ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { login } from "@/auth";

const ERRORS = { 400: "login.errors.invalid", 429: "login.errors.throttled" };

const route = useRoute();
const router = useRouter();
const email = ref("");
const password = ref("");
const error = ref(null);
const submitting = ref(false);

// Only same-origin paths: `//host` and `/\host` would leave the app
function nextPath() {
  const next = route.query.next;
  return typeof next === "string" && /^\/(?![/\\])/.test(next) ? next : "/";
}

async function submit() {
  error.value = null;
  submitting.value = true;
  try {
    await login(email.value, password.value);
    await router.push(nextPath());
  } catch (e) {
    error.value = ERRORS[e.status] ?? "login.errors.generic";
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="mx-auto max-w-sm">
    <h1 class="text-2xl font-semibold">{{ $t("login.title") }}</h1>
    <p class="mt-1 text-slate-500">{{ $t("app.tagline") }}</p>
    <form class="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-6" @submit.prevent="submit">
      <p v-if="error" role="alert" class="rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
      <label class="block">
        <span class="text-sm font-medium">{{ $t("login.email") }}</span>
        <input
          v-model="email"
          type="email"
          name="email"
          autocomplete="email"
          required
          class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
      </label>
      <label class="block">
        <span class="text-sm font-medium">{{ $t("login.password") }}</span>
        <input
          v-model="password"
          type="password"
          name="password"
          autocomplete="current-password"
          required
          class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
      </label>
      <button
        type="submit"
        :disabled="submitting"
        class="w-full rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {{ $t("login.submit") }}
      </button>
    </form>
  </section>
</template>
