<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";

import { apiFetch } from "@/api/client";
import { auth } from "@/auth";

const INPUT_FIELDS = [
  { name: "first_name", type: "text", autocomplete: "off" },
  { name: "last_name", type: "text", autocomplete: "off" },
  { name: "email", type: "email", autocomplete: "off" },
  { name: "password", type: "password", autocomplete: "new-password" },
  { name: "password_confirm", type: "password", autocomplete: "new-password" },
];
const CHECKBOX_FIELDS = ["is_staff", "is_active"];

const route = useRoute();
const router = useRouter();
// Editing an existing user when the route has an id, creating a new one otherwise
const userId = route.params.id ? Number(route.params.id) : null;
const isSelf = userId === auth.user.id;
const form = reactive({
  first_name: "",
  last_name: "",
  email: "",
  is_staff: false,
  is_active: true,
  password: "",
  password_confirm: "",
});
const loaded = ref(userId === null);
// Messages coming from the backend are already translated, the others are i18n keys
const fieldErrors = ref({});
const error = ref(null);
const submitting = ref(false);
const title = computed(() => (userId === null ? "users.form.titleNew" : "users.form.titleEdit"));

// The email is always required, the password only for new users
function isRequired(name) {
  return name === "email" || (userId === null && name.startsWith("password"));
}

onMounted(async () => {
  if (userId === null) {
    return;
  }
  try {
    const user = await apiFetch(`/users/${userId}/`);
    for (const field of ["first_name", "last_name", "email", "is_staff", "is_active"]) {
      form[field] = user[field];
    }
    loaded.value = true;
  } catch {
    error.value = "users.form.errors.load";
  }
});

// Keeps the header up to date when admins edit their own account
function syncAuthUser(user) {
  if (isSelf) {
    Object.assign(auth.user, { email: user.email, first_name: user.first_name, last_name: user.last_name });
  }
}

async function submit() {
  error.value = null;
  fieldErrors.value = {};
  const { password_confirm: passwordConfirm, ...data } = form;
  if (data.password !== passwordConfirm) {
    error.value = "users.form.errors.mismatch";
    return;
  }
  // An empty password keeps the current one
  if (!data.password) {
    delete data.password;
  }
  submitting.value = true;
  try {
    const user =
      userId !== null
        ? await apiFetch(`/users/${userId}/`, { method: "PATCH", body: data })
        : await apiFetch("/users/", { method: "POST", body: data });
    syncAuthUser(user);
    await router.push({ name: "users" });
  } catch (e) {
    if (e.status === 400) {
      fieldErrors.value = e.data;
      error.value = "users.form.errors.invalid";
    } else {
      error.value = "users.form.errors.generic";
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
      <label v-for="field in INPUT_FIELDS" :key="field.name" class="block">
        <span class="text-sm font-medium">{{ $t(`users.form.fields.${field.name}`) }}</span>
        <input
          v-model="form[field.name]"
          :type="field.type"
          :name="field.name"
          :autocomplete="field.autocomplete"
          :required="isRequired(field.name)"
          class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
        <span v-for="message in fieldErrors[field.name]" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </label>
      <p v-if="userId !== null" class="text-sm text-slate-500">{{ $t("users.form.passwordHint") }}</p>
      <label v-for="name in CHECKBOX_FIELDS" :key="name" class="block">
        <span class="flex items-center gap-2">
          <input v-model="form[name]" type="checkbox" :name="name" :disabled="isSelf" class="accent-brand" />
          <span class="text-sm font-medium">{{ $t(`users.form.fields.${name}`) }}</span>
        </span>
        <span v-for="message in fieldErrors[name]" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </label>
      <p v-if="isSelf" class="text-sm text-slate-500">{{ $t("users.form.ownAccountHint") }}</p>
      <div class="flex gap-2">
        <button
          type="submit"
          :disabled="submitting"
          class="flex-1 rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
        >
          {{ $t("users.form.save") }}
        </button>
        <RouterLink
          :to="{ name: 'users' }"
          class="flex-1 rounded border border-slate-300 px-4 py-2 text-center font-medium hover:border-brand"
        >
          {{ $t("users.form.cancel") }}
        </RouterLink>
      </div>
    </form>
  </section>
</template>
