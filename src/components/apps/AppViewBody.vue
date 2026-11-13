<script setup>
import { computed, onBeforeUnmount, provide, watch } from "vue";
import AppNode from "./AppNode.vue";
import { createScreenRuntime } from "./appRuntime.js";
import { APP_AREA_KEY, APP_SCREEN_KEY, useScreenSignal } from "./screenKeys.js";
import { useAppStyle } from "./useAppStyle.js";
import { useLiveData } from "./useLiveData.js";

// A view's parts as they run (D-55), anywhere one shows: its card, its viewer, or a screen of an app.
// It has its own screen runtime, its figures stay live, and nothing in it can be pressed. On an app's screen, its
// reads stop with the screen's (appRuntime.js stop()), and when it goes.
const props = defineProps({
  slug: { type: String, required: true },
  version: { type: String, default: "live" },
  screenKey: { type: String, default: "main" },
  screen: { type: Object, required: true },
  tables: { type: Array, required: true },
  params: { type: Object, default: () => ({}) },
  // The view's own area and CSS; a copy has neither, and takes the app's.
  area: { type: String, default: "" },
  css: { type: String, default: "" },
  path: { type: String, default: "" },
  visible: { type: Boolean, default: true }
});

const noEffects = () => {};
const runtime = createScreenRuntime({
  slug: props.slug,
  version: props.version,
  tables: props.tables,
  screen: props.screen,
  screenKey: props.screenKey,
  params: props.params,
  onEffects: noEffects,
  onError: noEffects
});
const screenAround = useScreenSignal();
if (screenAround.aborted) runtime.stop();
else screenAround.addEventListener("abort", runtime.stop, { once: true });
provide(APP_SCREEN_KEY, runtime);
provide(APP_AREA_KEY, computed(() => (props.area ? `[data-app-style="${props.area}"]` : null)));
useAppStyle(computed(() => props.css));
const { catchUp } = useLiveData(runtime, () => props.visible);
watch(() => props.visible, (visible) => visible && catchUp());
runtime.loadAll();
onBeforeUnmount(runtime.followState());
onBeforeUnmount(() => {
  screenAround.removeEventListener("abort", runtime.stop);
  runtime.stop();
});
</script>

<template>
  <div class="d-flex flex-column ga-4" :data-app-style="area || undefined">
    <AppNode v-for="(node, index) in screen.content" :key="index" :node="node" :path="`${path}content/${index}`" />
  </div>
</template>
