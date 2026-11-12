<script setup>
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";

import { apiFetch } from "@/api/client";
import CategoryIcon from "@/components/CategoryIcon.vue";
import IconPicker from "@/components/IconPicker.vue";

// New items take these colors in turn, so that they are told apart at a glance
const PALETTE = ["#2563eb", "#16a34a", "#dc2626", "#d97706", "#7c3aed", "#db2777", "#0891b2", "#64748b"];

// Categories and tags are both names with a color, managed by the same page; only categories have an icon
const props = defineProps({
  resource: { type: String, required: true },
  withIcon: { type: Boolean, default: false },
});

const { t } = useI18n();
const items = ref(null);
const draft = ref({});
// The id of the item being edited, if any
const editing = ref(null);
const editDraft = ref({});
// Messages coming from the backend are already translated, the others are i18n keys
const createErrors = ref([]);
const editErrors = ref([]);
const error = ref(null);

// The fields sent to the backend
function fieldsOf({ name, color, icon }) {
  return props.withIcon ? { name, color, icon } : { name, color };
}

function resetDraft() {
  draft.value = fieldsOf({ name: "", color: PALETTE[items.value.length % PALETTE.length], icon: "" });
}

function sortItems() {
  items.value.sort((a, b) => a.name.localeCompare(b.name));
}

// Runs a write request; the field errors returned by the backend end up in `fieldErrors`
async function write(request, fieldErrors) {
  error.value = null;
  fieldErrors.value = [];
  try {
    return await request();
  } catch (e) {
    if (e.status === 400) {
      fieldErrors.value = Object.values(e.data).flat();
    } else {
      error.value = `${props.resource}.errors.save`;
    }
    return null;
  }
}

async function create() {
  const item = await write(() => apiFetch(`/${props.resource}/`, { method: "POST", body: draft.value }), createErrors);
  if (item) {
    items.value.push(item);
    sortItems();
    resetDraft();
  }
}

function startEdit(item) {
  editing.value = item.id;
  editDraft.value = fieldsOf(item);
  editErrors.value = [];
}

async function rename(item) {
  const updated = await write(
    () => apiFetch(`/${props.resource}/${item.id}/`, { method: "PATCH", body: editDraft.value }),
    editErrors,
  );
  if (updated) {
    Object.assign(item, updated);
    sortItems();
    editing.value = null;
  }
}

async function remove(item) {
  if (!window.confirm(t(`${props.resource}.confirmDelete`, { name: item.name }))) {
    return;
  }
  error.value = null;
  try {
    await apiFetch(`/${props.resource}/${item.id}/`, { method: "DELETE" });
    items.value = items.value.filter((other) => other.id !== item.id);
  } catch {
    error.value = `${props.resource}.errors.delete`;
  }
}

// The router reuses this component when moving between categories and tags
watch(
  () => props.resource,
  async (resource) => {
    items.value = null;
    error.value = null;
    editing.value = null;
    createErrors.value = [];
    try {
      items.value = await apiFetch(`/${resource}/`);
      resetDraft();
    } catch {
      error.value = `${resource}.errors.load`;
    }
  },
  { immediate: true },
);
</script>

<template>
  <section class="mx-auto max-w-xl">
    <h1 class="text-2xl font-semibold">{{ $t(`${resource}.title`) }}</h1>
    <p class="mt-1 text-slate-500">{{ $t(`${resource}.intro`) }}</p>
    <p v-if="error" role="alert" class="mt-6 rounded bg-red-50 px-3 py-2 text-sm text-expense">
      {{ $t(error) }}
    </p>
    <p v-if="!items && !error" class="mt-6 text-slate-500">{{ $t("labels.loading") }}</p>
    <template v-if="items">
      <form class="mt-6 flex flex-wrap items-center gap-2" @submit.prevent="create">
        <label>
          <span class="sr-only">{{ $t("labels.color") }}</span>
          <input
            v-model="draft.color"
            type="color"
            name="color"
            class="block h-10 w-12 cursor-pointer rounded border border-slate-300 bg-white p-1"
          />
        </label>
        <IconPicker v-if="withIcon" v-model="draft.icon" name="icon" />
        <label class="flex-1">
          <span class="sr-only">{{ $t("labels.name") }}</span>
          <input
            v-model="draft.name"
            type="text"
            name="name"
            autocomplete="off"
            maxlength="50"
            required
            :placeholder="$t(`${resource}.placeholder`)"
            class="block w-full rounded border border-slate-300 px-3 py-2 focus:border-brand focus:outline-none"
          />
        </label>
        <button type="submit" class="rounded bg-brand px-4 py-2 font-medium text-white hover:bg-brand-dark">
          {{ $t("labels.add") }}
        </button>
        <span v-for="message in createErrors" :key="message" class="block w-full text-sm text-expense">
          {{ message }}
        </span>
      </form>
      <p
        v-if="!items.length"
        class="mt-4 rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-slate-500"
      >
        {{ $t(`${resource}.empty`) }}
      </p>
      <ul v-else class="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm">
        <li v-for="item in items" :key="item.id" class="px-4 py-2">
          <form v-if="editing === item.id" class="flex flex-wrap items-center gap-3" @submit.prevent="rename(item)">
            <label>
              <span class="sr-only">{{ $t("labels.color") }}</span>
              <input
                v-model="editDraft.color"
                type="color"
                name="edit_color"
                class="block h-8 w-10 cursor-pointer rounded border border-slate-300 bg-white p-0.5"
              />
            </label>
            <IconPicker v-if="withIcon" v-model="editDraft.icon" name="edit_icon" compact />
            <label class="flex-1">
              <span class="sr-only">{{ $t("labels.name") }}</span>
              <input
                v-model="editDraft.name"
                type="text"
                name="edit_name"
                autocomplete="off"
                maxlength="50"
                required
                class="block w-full rounded border border-slate-300 px-2 py-1 focus:border-brand focus:outline-none"
              />
            </label>
            <button type="submit" class="py-1 text-brand hover:underline">{{ $t("labels.save") }}</button>
            <button type="button" class="py-1 text-slate-500 hover:underline" @click="editing = null">
              {{ $t("labels.cancel") }}
            </button>
            <span v-for="message in editErrors" :key="message" class="block w-full text-sm text-expense">
              {{ message }}
            </span>
          </form>
          <div v-else class="flex items-center justify-between gap-4">
            <span class="flex items-center gap-2">
              <CategoryIcon
                v-if="withIcon && item.icon"
                :name="item.icon"
                data-icon
                class="size-4 shrink-0"
                :style="{ color: item.color }"
              />
              <span v-else class="size-3 shrink-0 rounded-full" :style="{ backgroundColor: item.color }" />
              <span data-name>{{ item.name }}</span>
            </span>
            <span class="whitespace-nowrap">
              <button type="button" class="text-brand hover:underline" @click="startEdit(item)">
                {{ $t("labels.edit") }}
              </button>
              <button type="button" class="ml-3 text-expense hover:underline" @click="remove(item)">
                {{ $t("labels.delete") }}
              </button>
            </span>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>
