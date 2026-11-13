<script setup>
import { onMounted, shallowRef, watch } from "vue";
import AppTheme from "./AppTheme.vue";
import AppViewBody from "./AppViewBody.vue";
import { appsApi } from "./appsApi.js";

// A view by its key, in its own look, for its card and its viewer (D-55). `shown` holds it back until
// it's first seen; `reloads` going up reads it again, after a restore. It tells the page when it
// has loaded, and when it isn't there for this person.
const props = defineProps({
  slug: { type: String, required: true },
  shown: { type: Boolean, default: true },
  visible: { type: Boolean, default: true },
  reloads: { type: Number, default: 0 }
});
const emit = defineEmits(["loaded", "missing"]);
const loaded = shallowRef(null);

async function load() {
  try {
    loaded.value = await appsApi.get(props.slug);
    emit("loaded", loaded.value);
  } catch {
    emit("missing");
  }
}
onMounted(() => props.shown && load());
watch(() => props.shown, (shown) => shown && !loaded.value && load());
watch(() => props.reloads, load);
</script>

<template>
  <AppTheme v-if="loaded?.definition" :theme="loaded.theme">
    <AppViewBody
      :key="loaded.version.id"
      :slug="loaded.app.slug"
      :screen="loaded.definition.screens.main"
      :tables="loaded.tables"
      :area="loaded.app.id"
      :css="loaded.style || ''"
      :visible="visible"
    />
  </AppTheme>
  <v-skeleton-loader v-else type="table-tbody" />
</template>
