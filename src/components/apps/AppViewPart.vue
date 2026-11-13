<script setup>
import { computed, inject, onMounted, shallowRef } from "vue";
import AppViewBody from "./AppViewBody.vue";
import { appsApi } from "./appsApi.js";
import { APP_SCREEN_KEY } from "./screenKeys.js";

// A view shown inside an app's screen (D-55): shared, it's the view's current version through its
// own routes; a copy, it's a screen of this app. Its parameters are worked out on the screen around it.
const props = defineProps({
  node: { type: Object, required: true },
  path: { type: String, required: true },
  scope: { type: Object, default: () => ({}) }
});

/** @type {import("../../types.js").ScreenRuntime} */
const host = inject(APP_SCREEN_KEY);
const shared = shallowRef(null);
const gone = shallowRef(false);

const params = computed(() =>
  Object.fromEntries(Object.entries(props.node.params || {}).map(([name, value]) => [name, String(host.evaluate(value, props.scope) ?? "")])));
const copy = computed(() => {
  const screen = props.node.screen && host.screens?.[props.node.screen];
  return screen ? { slug: host.slug, version: host.version, screenKey: props.node.screen, screen, tables: host.tables } : null;
});
const source = computed(() => copy.value || shared.value);

onMounted(async () => {
  if (props.node.screen) return;
  try {
    const { app, screen, tables, style } = await appsApi.viewPart(props.node.view);
    shared.value = { slug: app.slug, screen, tables, area: app.id, css: style || "" };
  } catch {
    gone.value = true;
  }
});
</script>

<template>
  <v-card v-if="gone || (node.screen && !copy)" flat class="pa-4 text-body-2 text-medium-emphasis">This view isn't available here.</v-card>
  <AppViewBody v-else-if="source" :key="JSON.stringify(params)" v-bind="source" :params="params" :path="`${path}/view/`" />
  <v-skeleton-loader v-else type="table-tbody" />
</template>
