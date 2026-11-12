<script setup>
import { computed } from "vue";

import { CATEGORY_ICONS } from "@/icons";

const props = defineProps({ name: { type: String, required: true } });
// Names outside the curated set (e.g. saved before an icon was removed from it) render nothing
const icon = computed(() => CATEGORY_ICONS[props.name]);
</script>

<template>
  <component :is="icon" v-if="icon" aria-hidden="true" />
</template>
