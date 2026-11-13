<script setup>
import { onMounted, ref } from "vue";
import { PAPER } from "@/theme/palettes.js";
import { EDITABLE, fileKind, fileUrl, openOnComputer, previewUrl } from "./filesApi.js";
import { useEscapeToClose } from "./useEscapeToClose.js";

// A file the bot saved, shown large (D-20): documents, spreadsheets, slides and PDFs as pictures
// of their pages, pictures and text as they are. Anything else offers the download instead.
const props = defineProps({
  // Without a bot, a file in the home's own folder (the home's Files page).
  botId: { type: String, default: null },
  // A file a bot made in a group with several people (D-46).
  group: { type: String, default: null },
  file: { type: Object, required: true }
});
const emit = defineEmits(["close", "opened"]);

const preview = ref(null);
const problem = ref("");
const loading = ref(true);
const editable = Boolean(props.botId) && !props.group && EDITABLE.has(props.file.name.split(".").pop().toLowerCase());
const opening = ref(false);

// Edit it in its app on the bot's computer; the live view takes over from here.
async function edit() {
  opening.value = true;
  try {
    await openOnComputer(props.botId, props.file.path);
    emit("opened");
  } catch (error) {
    problem.value = error?.message || "The computer couldn't open it.";
  } finally {
    opening.value = false;
  }
}

async function load() {
  try {
    const response = await fetch(previewUrl(props.botId, props.file.path, props.group), { credentials: "include" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      problem.value = body.error || "This file can't be shown.";
      return;
    }
    preview.value = await response.json();
  } catch {
    problem.value = "This file can't be shown right now.";
  } finally {
    loading.value = false;
  }
}

useEscapeToClose(() => emit("close"));
onMounted(() => load());
</script>

<template>
  <v-theme-provider theme="dark" with-background class="mb-viewer" role="dialog" :aria-label="file.name" @click.self="emit('close')">
    <div class="mb-viewer__bar">
      <v-icon :icon="fileKind(file.name).icon" size="20" />
      <span class="mb-viewer__name">{{ file.name }}</span>
      <button v-if="editable" type="button" class="mb-viewer__edit" :disabled="opening" @click="edit">
        <v-icon icon="$screenshotMonitor" size="16" />{{ opening ? "Opening…" : "Edit on computer" }}
      </button>
      <a class="mb-viewer__button" :href="fileUrl(botId, file.path, { group })" :download="file.name" aria-label="Download"><v-icon icon="$download" size="18" /></a>
      <button type="button" class="mb-viewer__button" aria-label="Close" @click="emit('close')"><v-icon icon="$close" size="18" /></button>
    </div>
    <div class="mb-viewer__body" @click.self="emit('close')">
      <v-progress-circular v-if="loading" indeterminate color="white" size="32" width="3" />
      <div v-else-if="problem" class="mb-viewer__problem">
        <p>{{ problem }}</p>
        <a class="mb-viewer__download" :href="fileUrl(botId, file.path, { group })" :download="file.name">Download {{ file.name }}</a>
      </div>
      <img v-else-if="preview.kind === 'image'" class="mb-viewer__picture" :src="fileUrl(botId, file.path, { download: false, group })" :alt="file.name">
      <v-theme-provider v-else-if="preview.kind === 'text'" theme="light" with-background tag="pre" class="mb-viewer__text">{{ preview.text }}</v-theme-provider>
      <div v-else class="mb-viewer__pages">
        <img v-for="(page, index) in preview.pages" :key="index" class="mb-viewer__page" :style="{ background: PAPER }" :src="page" :alt="`Page ${index + 1}`">
        <p v-if="preview.more" class="mb-viewer__more">Download the file to see the rest.</p>
      </div>
    </div>
  </v-theme-provider>
</template>

<style scoped>
.mb-viewer {
  position: fixed;
  inset: 0;
  z-index: 2500;
  display: flex;
  flex-direction: column;
  background: rgba(var(--v-theme-scrim), 0.85);
}

.mb-viewer__bar {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  margin-bottom: 12px;
  padding: 0 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-viewer__name {
  flex: 1;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-viewer__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: rgba(var(--v-theme-on-surface), 0.16);
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}

.mb-viewer__edit {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 16px;
  background: rgb(var(--v-theme-inverse-surface));
  color: rgb(var(--v-theme-inverse-on-surface));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.mb-viewer__edit:disabled {
  opacity: 0.6;
  cursor: default;
}

.mb-viewer__body {
  display: flex;
  flex: 1;
  align-items: flex-start;
  justify-content: center;
  min-height: 0;
  padding: 0 48px 32px;
}

.mb-viewer__pages,
.mb-viewer__text {
  width: 100%;
  max-width: 900px;
  height: 100%;
  overflow-y: auto;
}

.mb-viewer__pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.mb-viewer__page {
  width: 100%;
  border-radius: 4px;
}

.mb-viewer__more {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
}

.mb-viewer__text {
  margin: 0;
  padding: 24px;
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-container-lowest));
  color: rgb(var(--v-theme-on-surface));
  font-size: 13px;
  line-height: 20px;
  white-space: pre-wrap;
}

.mb-viewer__picture {
  max-width: 100%;
  max-height: 100%;
  border-radius: 6px;
}

@media (max-width: 600px) {
  .mb-viewer__body {
    padding: 0 8px 12px;
  }
}

.mb-viewer__problem {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 14px;
}

.mb-viewer__download {
  padding: 8px 16px;
  border-radius: 18px;
  background: rgb(var(--v-theme-inverse-surface));
  color: rgb(var(--v-theme-inverse-on-surface));
  font-weight: 500;
  text-decoration: none;
}
</style>
