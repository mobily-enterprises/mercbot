<script setup>
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import AppTile from "./AppTile.vue";
import { usePinnedApps } from "./usePinnedApps.js";
import MercbotIconButton from "../mercbot/MercbotIconButton.vue";

// The Apps entry in the sidebar (D-35): one link to the Apps area. `icon` makes it an icon button for the sidebar's top
// row, beside Search and Files (the person's pinned apps are the list's own Apps section, MercbotChatList); `rail` shows
// the link and the pinned apps' pictures in the compact rail.
defineProps({
  rail: { type: Boolean, default: false },
  icon: { type: Boolean, default: false }
});
const paths = usePaths();
const { pinned } = usePinnedApps();
</script>

<template>
  <MercbotIconButton v-if="icon" :to="paths.page('/apps')" icon="$gridView" label="Apps" tone="bare" class="mb-apps-entry__link" />
  <div v-else class="mb-apps-entry" :class="{ 'mb-apps-entry--rail': rail }">
    <v-btn :to="paths.page('/apps')" variant="text" :prepend-icon="rail ? undefined : '$gridView'" :icon="rail ? '$gridView' : undefined" :block="!rail" class="mb-apps-entry__link" aria-label="Apps">
      <template v-if="!rail">Apps</template>
    </v-btn>
    <v-btn
      v-for="app in pinned"
      :key="app.id"
      :to="paths.page(`/apps/${app.slug}`)"
      variant="text"
      :block="!rail"
      :icon="rail"
      class="mb-apps-entry__app"
      :aria-label="app.name"
    >
      <AppTile :icon="app.icon" :color="app.color" :picture="app.picture" :size="22" />
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
