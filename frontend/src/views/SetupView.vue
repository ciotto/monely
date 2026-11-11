<script setup>
import { reactive, ref } from "vue";
import { useRouter } from "vue-router";

import { fetchUser, setup } from "@/auth";

const FIELDS = [
  { name: "first_name", type: "text", autocomplete: "given-name" },
  { name: "last_name", type: "text", autocomplete: "family-name" },
  { name: "email", type: "email", autocomplete: "email", required: true },
  { name: "password", type: "password", autocomplete: "new-password", required: true },
  { name: "password_confirm", type: "password", autocomplete: "new-password", required: true },
];

const router = useRouter();
const form = reactive(Object.fromEntries(FIELDS.map((field) => [field.name, ""])));
// Messages coming from the backend are already translated, the others are i18n keys
const fieldErrors = ref({});
const error = ref(null);
const submitting = ref(false);

async function submit() {
  error.value = null;
  fieldErrors.value = {};
  const { password_confirm: passwordConfirm, ...data } = form;
  if (data.password !== passwordConfirm) {
    error.value = "setup.errors.mismatch";
    return;
  }
  submitting.value = true;
  try {
    await setup(data);
    await router.push({ name: "dashboard" });
  } catch (e) {
    if (e.status === 404) {
      // Someone else completed the setup in the meantime: the guard sends the user to the login
      await fetchUser();
      await router.push({ name: "dashboard" });
    } else if (e.status === 400) {
      fieldErrors.value = e.data;
      error.value = "setup.errors.invalid";
    } else {
      error.value = "setup.errors.generic";
    }
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <section class="mx-auto max-w-sm">
    <h1 class="text-2xl font-semibold">{{ $t("setup.title") }}</h1>
    <p class="mt-1 text-slate-500">{{ $t("setup.intro") }}</p>
    <form class="mt-6 space-y-4 rounded-lg border border-slate-200 bg-white p-6" @submit.prevent="submit">
      <p v-if="error" role="alert" class="rounded bg-red-50 px-3 py-2 text-sm text-expense">{{ $t(error) }}</p>
      <label v-for="field in FIELDS" :key="field.name" class="block">
        <span class="text-sm font-medium">{{ $t(`setup.fields.${field.name}`) }}</span>
        <input
          v-model="form[field.name]"
          :type="field.type"
          :name="field.name"
          :autocomplete="field.autocomplete"
          :required="field.required"
          class="mt-1 block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
        />
        <span v-for="message in fieldErrors[field.name]" :key="message" class="mt-1 block text-sm text-expense">
          {{ message }}
        </span>
      </label>
      <button
        type="submit"
        :disabled="submitting"
        class="w-full rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark disabled:opacity-60"
      >
        {{ $t("setup.submit") }}
      </button>
    </form>
  </section>
</template>
