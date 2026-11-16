<script setup>
import { ChevronDown } from "@lucide/vue";
import { onBeforeUnmount, onMounted, ref, useTemplateRef, watch } from "vue";
import { useRoute } from "vue-router";

// A button that opens a menu of links and actions; it closes on a choice, on a click outside, on Escape and when the
// page changes
defineProps({
  name: { type: String, required: true },
  disabled: { type: Boolean, default: false },
});
const route = useRoute();
const open = ref(false);
const root = useTemplateRef("root");

watch(
  () => route.fullPath,
  () => (open.value = false),
);

function closeOnOutsideClick(event) {
  if (!root.value?.contains(event.target)) {
    open.value = false;
  }
}

function closeOnEscape(event) {
  if (event.key === "Escape") {
    open.value = false;
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
</script>

<template>
  <div ref="root" class="relative">
    <button
      type="button"
      :name="name"
      :disabled="disabled"
      aria-haspopup="true"
      :aria-expanded="open"
      class="flex items-center gap-2 rounded border border-slate-300 bg-white px-4 py-2 text-slate-700 hover:bg-slate-50 disabled:cursor-wait disabled:opacity-60"
      @click="open = !open"
    >
      <slot name="button" />
      <ChevronDown class="size-4" aria-hidden="true" />
    </button>
    <div
      v-if="open"
      :data-menu="name"
      class="absolute right-0 z-10 mt-2 w-64 rounded-md border border-slate-200 bg-white py-1 font-normal shadow-lg"
      @click="open = false"
    >
      <slot />
    </div>
  </div>
</template>
