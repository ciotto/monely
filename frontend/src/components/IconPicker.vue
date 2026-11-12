<script setup>
import { Ban } from "@lucide/vue";
import { ref } from "vue";

import CategoryIcon from "@/components/CategoryIcon.vue";
import { CATEGORY_ICONS } from "@/icons";

// The name of the chosen icon, empty for none
const model = defineModel({ type: String, required: true });
defineProps({
  name: { type: String, required: true },
  compact: { type: Boolean, default: false },
});

const open = ref(false);
const root = ref(null);

function choose(icon) {
  model.value = icon;
  open.value = false;
}

// Closes the panel when the focus moves outside the picker
function onFocusOut(event) {
  if (!root.value.contains(event.relatedTarget)) {
    open.value = false;
  }
}
</script>

<template>
  <div ref="root" class="relative" @focusout="onFocusOut" @keydown.esc="open = false">
    <button
      type="button"
      :name="name"
      :aria-label="$t('labels.icon')"
      :aria-expanded="open"
      class="flex items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:border-brand"
      :class="compact ? 'h-8 w-10' : 'h-10 w-12'"
      @click="open = !open"
    >
      <CategoryIcon v-if="model" :name="model" class="size-5" />
      <Ban v-else class="size-5 text-slate-300" aria-hidden="true" />
    </button>
    <div
      v-if="open"
      class="absolute left-0 z-10 mt-1 grid w-72 grid-cols-8 gap-1 rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
    >
      <button
        type="button"
        data-icon=""
        :title="$t('icons.none')"
        :aria-label="$t('icons.none')"
        :aria-pressed="!model"
        class="flex size-8 items-center justify-center rounded text-slate-400 hover:bg-slate-100"
        :class="{ 'ring-2 ring-brand': !model }"
        @click="choose('')"
      >
        <Ban class="size-4" aria-hidden="true" />
      </button>
      <button
        v-for="icon in Object.keys(CATEGORY_ICONS)"
        :key="icon"
        type="button"
        :data-icon="icon"
        :title="$t(`icons.${icon}`)"
        :aria-label="$t(`icons.${icon}`)"
        :aria-pressed="model === icon"
        class="flex size-8 items-center justify-center rounded text-slate-700 hover:bg-slate-100"
        :class="{ 'ring-2 ring-brand': model === icon }"
        @click="choose(icon)"
      >
        <CategoryIcon :name="icon" class="size-4" />
      </button>
    </div>
  </div>
</template>
