<script setup>
import { computed } from "vue";
import { fileUrl } from "@/components/mercbot/filesApi.js";
import { appGlyph } from "./appRuntime.js";

// An app's, a view's or a template's tile (D-141): a bot's picture of its own when it has one, else its set picture
// drawn white on its colour.
const props = defineProps({
  icon: { type: String, required: true },
  color: { type: String, required: true },
  picture: { type: String, default: null },
  size: { type: Number, required: true }
});
const src = computed(() => (props.picture ? fileUrl(null, props.picture, { download: false, chat: null }) : ""));
</script>

<template>
  <v-avatar :color="color" :size="size" :rounded="size < 32 ? 'md' : 'lg'">
    <v-img v-if="src" :src="src" alt="" cover />
    <v-icon v-else :icon="appGlyph(icon)" color="white" :size="Math.round(size * 0.6)" />
  </v-avatar>
</template>
