<script setup>
import { onBeforeUnmount, onMounted, ref } from "vue";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { appsApi } from "./appsApi.js";
import { ICON_PATHS } from "./appRuntime.js";
import MercbotIconButton from "../mercbot/MercbotIconButton.vue";
import MercbotTooltip from "../mercbot/MercbotTooltip.vue";

// The Apps entry in the sidebar (D-35): one link to the Apps area, then the person's pinned apps. `icon` makes them icon
// buttons for the sidebar's top row, beside Search and Files; `rail` icons in the compact rail.
defineProps({
  rail: { type: Boolean, default: false },
  icon: { type: Boolean, default: false }
});
const paths = usePaths();
const apps = ref([]);
const pins = ref([]);

async function load() {
  try {
    const result = await appsApi.list();
    apps.value = result.apps;
    pins.value = result.pins;
  } catch {
    apps.value = [];
  }
}
const pinned = () => pins.value.map((id) => apps.value.find((app) => app.id === id)).filter(Boolean);

onMounted(() => {
  load();
  window.addEventListener("mercbot:apps-changed", load);
});
onBeforeUnmount(() => window.removeEventListener("mercbot:apps-changed", load));
</script>

<template>
  <template v-if="icon">
    <MercbotIconButton :to="paths.page('/apps')" icon="$gridView" label="Apps" tone="bare" class="mb-apps-entry__link" />
    <MercbotTooltip v-for="app in pinned()" :key="app.id" :text="app.name">
      <template #default="{ props: tooltipProps }">
        <v-btn v-bind="tooltipProps" :to="paths.page(`/apps/${app.slug}`)" icon variant="text" class="mb-apps-entry__app" :aria-label="app.name">
          <v-avatar :color="app.color" size="22" rounded="md"><v-icon :icon="ICON_PATHS[app.icon] || ICON_PATHS.apps" size="14" color="white" /></v-avatar>
        </v-btn>
      </template>
    </MercbotTooltip>
  </template>
  <div v-else class="mb-apps-entry" :class="{ 'mb-apps-entry--rail': rail }">
    <v-btn :to="paths.page('/apps')" variant="text" :prepend-icon="rail ? undefined : '$gridView'" :icon="rail ? '$gridView' : undefined" :block="!rail" class="mb-apps-entry__link" aria-label="Apps">
      <template v-if="!rail">Apps</template>
    </v-btn>
    <v-btn
      v-for="app in pinned()"
      :key="app.id"
      :to="paths.page(`/apps/${app.slug}`)"
      variant="text"
      :block="!rail"
      :icon="rail"
      class="mb-apps-entry__app"
      :aria-label="app.name"
    >
      <v-avatar :color="app.color" size="22" rounded="md"><v-icon :icon="ICON_PATHS[app.icon] || ICON_PATHS.apps" size="14" color="white" /></v-avatar>
      <span v-if="!rail" class="ml-3 text-truncate">{{ app.name }}</span>
    </v-btn>
  </div>
</template>

<style scoped>
.mb-apps-entry {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px 8px;
}
.mb-apps-entry--rail {
  align-items: center;
}
.mb-apps-entry__link,
.mb-apps-entry__app {
  justify-content: flex-start;
  text-transform: none;
  letter-spacing: normal;
}
</style>
