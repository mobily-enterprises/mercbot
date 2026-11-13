<script setup>
import { onMounted, ref } from "vue";
import ShellUpButton from "@jskit-ai/shell-web/client/components/ShellUpButton";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import MercbotAvatar from "@/components/mercbot/MercbotAvatar.vue";
import { filesApi, storageApi } from "@/components/mercbot/filesApi.js";
import { useHomes } from "@/components/mercbot/homesApi.js";
import { driveNotices, moveNotice } from "@/components/mercbot/storageNotices.js";
import FileBrowser from "./FileBrowser.vue";

// The home's files (D-47): its own folder, shared with every person and bot in it, and its bots,
// each leading to the files the person has with it. A home whose files are in Google Drive says
// what Mercbot last saw there (D-80): its folder in the bin or deleted, the Drive nearly full; and
// while its files are being moved to other storage, that they're read-only.
const paths = usePaths();
const { current } = useHomes();
const bots = ref(null);
const notices = ref([]);

onMounted(async () => {
  storageApi.get().then((storage) => {
    notices.value = [moveNotice(storage), ...driveNotices(storage, "files")].filter(Boolean);
  }, () => {});
  try {
    bots.value = (await filesApi.homeBots()).bots;
  } catch {
    bots.value = [];
  }
});
</script>

<template>
  <div class="home-files">
    <header class="home-files__bar">
      <ShellUpButton />
    </header>
    <main class="home-files__main">
      <p v-for="notice in notices" :key="notice.key" class="home-files__notice" role="status">{{ notice.text }}</p>
      <FileBrowser :sections="[{ key: 'shared', label: current?.name || 'Whole home', root: '/files/shared' }]" />
      <section class="home-files__bots">
        <p class="home-files__section">Bots' files</p>
        <div v-if="!bots" class="home-files__skeleton" aria-hidden="true" />
        <p v-else-if="!bots.length" class="home-files__empty">No bots yet.</p>
        <div v-else class="home-files__grid">
          <router-link v-for="bot in bots" :key="bot.id" :to="{ path: paths.page('/'), query: { bot: bot.id, files: '1' } }" class="home-files__bot">
            <MercbotAvatar :bot="bot" :size="28" still />
            <span class="home-files__bot-name">{{ bot.name }}</span>
          </router-link>
        </div>
      </section>
    </main>
  </div>
</template>

<style scoped>
.home-files {
  min-height: 100vh;
}
.home-files__bar {
  display: flex;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.home-files__main {
  display: flex;
  flex-direction: column;
  gap: 32px;
  max-width: 760px;
  padding: 24px;
}
.home-files__notice {
  margin: 0 0 -16px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(var(--v-theme-error), 0.08);
  font-size: 13px;
}
.home-files__section {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface-variant));
}
.home-files__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 6px;
}
.home-files__bot {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  color: inherit;
  text-decoration: none;
}
.home-files__bot:hover,
.home-files__bot:focus-visible {
  background: rgba(var(--v-theme-on-surface), 0.06);
}
.home-files__bot-name {
  overflow: hidden;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.home-files__empty {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}
.home-files__skeleton {
  height: 80px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
</style>
