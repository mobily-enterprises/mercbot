<script setup>
import { onMounted, ref } from "vue";
import ShellUpButton from "@jskit-ai/shell-web/client/components/ShellUpButton";
import { storageApi } from "@/components/mercbot/filesApi.js";
import { driveNotices, moveNotice } from "@/components/mercbot/storageNotices.js";
import FileBrowser from "./FileBrowser.vue";

// The home's Files page (D-47): the file browser at Home files, with every other place the person can open (each bot's
// files, the rooms and chats) beside it. A home whose files are in Google Drive says what Mercbot last saw there
// (D-80): its folder in the bin or deleted, the Drive nearly full; and while its files are being moved to other
// storage, that they're read-only.
const notices = ref([]);

onMounted(() => {
  storageApi.get().then((storage) => {
    notices.value = [moveNotice(storage), ...driveNotices(storage, "files")].filter(Boolean);
  }, () => {});
});
</script>

<template>
  <div class="home-files">
    <header class="home-files__bar">
      <ShellUpButton />
    </header>
    <main class="home-files__main">
      <p v-for="notice in notices" :key="notice.key" class="home-files__notice" role="status">{{ notice.text }}</p>
      <FileBrowser />
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
  gap: 16px;
  max-width: 1040px;
  padding: 24px;
}
.home-files__notice {
  margin: 0;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(var(--v-theme-error), 0.08);
  font-size: 13px;
}
</style>
