<script setup>
import { computed, onMounted, ref } from "vue";
import { PAPER } from "@/theme/palettes.js";
import { EDITABLE, fileKind, fileUrl, openOnComputer, previewUrl } from "./filesApi.js";
import { useEscapeToClose } from "./useEscapeToClose.js";
import { renderRichText } from "./richText.js";

// A file the bot saved, shown large (D-20): an .xlsx or .csv as a table per sheet, with its sheets as tabs; Markdown
// formatted, tables included, with Source to read it as written; documents, other spreadsheets, slides and PDFs as
// pictures of their pages; pictures and text as they are. Anything else offers the download instead. A file is in a chat's
// folder, a bot's or the home's (D-112 R6): `chatId` and `botId` name where, and neither is the home's own folder (its
// Files page).
const props = defineProps({
  // The bot whose folder or computer it's reached through, or null.
  botId: { type: String, default: null },
  // The chat whose folder it's in, or null.
  chatId: { type: String, default: null },
  file: { type: Object, required: true }
});
const emit = defineEmits(["close", "opened"]);

const preview = ref(null);
const problem = ref("");
const loading = ref(true);
// Edit on computer opens it on that bot's computer in that chat (D14), so a file seen outside a chat isn't offered it.
const editable = Boolean(props.botId && props.chatId) && EDITABLE.has(props.file.name.split(".").pop().toLowerCase());
const opening = ref(false);

// Edit it in its app on the bot's computer in the chat; the live view takes over from here, for that bot.
async function edit() {
  opening.value = true;
  try {
    await openOnComputer(props.botId, props.file.path, props.chatId);
    emit("opened", { botId: props.botId, chatId: props.chatId });
  } catch (error) {
    problem.value = error?.message || "The computer couldn't open it.";
  } finally {
    opening.value = false;
  }
}

// Markdown shows formatted unless the person asks for its source.
const markdown = /\.(?:md|markdown)$/iu.test(props.file.name);
const source = ref(false);
// Task items ("- [x] Done") show as ticked or empty boxes, read-only here.
const rendered = computed(() => (markdown && preview.value?.kind === "text"
  ? renderRichText(preview.value.text).replace(/<li>\[( |x|X)\] /gu, (_item, mark) =>
    `<li class="mb-viewer__task"><input type="checkbox" disabled${mark.trim() ? " checked" : ""} aria-label="${mark.trim() ? "Done" : "Not done"}"> `)
  : ""));
// The sheet shown, of a spreadsheet's sheets.
const sheetIndex = ref(0);
const sheet = computed(() => preview.value?.sheets?.[sheetIndex.value] || null);
const columnName = (index) => {
  let name = "";
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
};

async function load() {
  try {
    const response = await fetch(previewUrl(props.botId, props.file.path, props.chatId), { credentials: "include" });
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
      <div v-if="rendered" class="mb-viewer__switch" role="group" aria-label="Show">
        <button type="button" :aria-pressed="!source" @click="source = false">Formatted</button>
        <button type="button" :aria-pressed="source" @click="source = true">Source</button>
      </div>
      <button v-if="editable" type="button" class="mb-viewer__edit" :disabled="opening" @click="edit">
        <v-icon icon="$screenshotMonitor" size="16" />{{ opening ? "Opening…" : "Edit on computer" }}
      </button>
      <a class="mb-viewer__button" :href="fileUrl(botId, file.path, { chat: chatId })" :download="file.name" aria-label="Download"><v-icon icon="$download" size="18" /></a>
      <button type="button" class="mb-viewer__button" aria-label="Close" @click="emit('close')"><v-icon icon="$close" size="18" /></button>
    </div>
    <div class="mb-viewer__body" @click.self="emit('close')">
      <v-progress-circular v-if="loading" indeterminate color="white" size="32" width="3" />
      <div v-else-if="problem" class="mb-viewer__problem">
        <p>{{ problem }}</p>
        <a class="mb-viewer__download" :href="fileUrl(botId, file.path, { chat: chatId })" :download="file.name">Download {{ file.name }}</a>
      </div>
      <img v-else-if="preview.kind === 'image'" class="mb-viewer__picture" :src="fileUrl(botId, file.path, { download: false, chat: chatId })" :alt="file.name">
      <div v-else-if="preview.kind === 'sheet'" class="mb-viewer__sheet">
        <div v-if="preview.sheets.length > 1" class="mb-viewer__tabs" role="tablist" aria-label="Sheets">
          <button
            v-for="(entry, index) in preview.sheets"
            :key="index"
            type="button"
            role="tab"
            :aria-selected="index === sheetIndex"
            @click="sheetIndex = index"
          >
            {{ entry.name }}
          </button>
        </div>
        <v-theme-provider theme="light" with-background class="mb-viewer__grid">
          <p v-if="!sheet.rows.length" class="mb-viewer__empty">This sheet is empty.</p>
          <table v-else>
            <thead>
              <tr>
                <th class="mb-viewer__corner" scope="col" />
                <th v-for="(_cell, index) in sheet.rows[0]" :key="index" class="mb-viewer__letter" scope="col">{{ columnName(index) }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(row, rowIndex) in sheet.rows" :key="rowIndex" :class="{ 'mb-viewer__header-row': rowIndex === 0 }">
                <th class="mb-viewer__number" scope="row">{{ rowIndex + 1 }}</th>
                <td v-for="(cell, index) in row" :key="index" :class="{ 'mb-viewer__number-cell': /^-?[\d.,]+%?$/u.test(cell) }">{{ cell }}</td>
              </tr>
            </tbody>
          </table>
        </v-theme-provider>
        <p v-if="sheet.more || preview.more" class="mb-viewer__more">Download the file to see the rest.</p>
      </div>
      <!-- eslint-disable-next-line vue/no-v-html -- markdown-it escapes raw HTML (html: false) -->
      <v-theme-provider v-else-if="rendered && !source" theme="light" with-background tag="article" class="mb-viewer__doc"><div class="mb-rich" v-html="rendered" /></v-theme-provider>
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

.mb-viewer__switch {
  display: inline-flex;
  padding: 2px;
  border-radius: 16px;
  background: rgba(var(--v-theme-on-surface), 0.1);
}

.mb-viewer__switch button {
  height: 28px;
  padding: 0 12px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.mb-viewer__switch button[aria-pressed="true"] {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  box-shadow: 0 1px 2px rgba(var(--v-theme-shadow), 0.2);
}

.mb-viewer__sheet {
  display: flex;
  flex-direction: column;
  width: 100%;
  max-width: 1200px;
  height: 100%;
  min-height: 0;
}

.mb-viewer__tabs {
  display: flex;
  gap: 4px;
  overflow-x: auto;
  margin-bottom: 8px;
}

.mb-viewer__tabs button {
  flex: none;
  height: 32px;
  padding: 0 14px;
  border: 0;
  border-radius: 16px;
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgb(var(--v-theme-on-surface));
  font-size: 13px;
  cursor: pointer;
}

.mb-viewer__tabs button[aria-selected="true"] {
  background: rgb(var(--v-theme-inverse-surface));
  color: rgb(var(--v-theme-inverse-on-surface));
  font-weight: 500;
}

/* As big as the sheet, scrolling once it's bigger than the screen. */
.mb-viewer__grid {
  flex: 0 1 auto;
  align-self: flex-start;
  max-width: 100%;
  min-height: 0;
  overflow: auto;
  border-radius: 6px;
}

.mb-viewer__grid table {
  border-collapse: separate;
  border-spacing: 0;
  font-size: 13px;
  line-height: 18px;
}

.mb-viewer__grid th,
.mb-viewer__grid td {
  max-width: 360px;
  padding: 6px 10px;
  border-right: 1px solid rgb(var(--v-theme-outline-variant));
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  text-align: left;
  vertical-align: top;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.mb-viewer__grid td {
  min-width: 80px;
}

/* The letters across the top and the row numbers down the side stay in view while it scrolls. */
.mb-viewer__grid thead th {
  position: sticky;
  top: 0;
  z-index: 1;
  background: rgb(var(--v-theme-surface-container));
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 500;
  text-align: center;
}

.mb-viewer__grid tbody th {
  position: sticky;
  left: 0;
  background: rgb(var(--v-theme-surface-container));
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 400;
  text-align: right;
}

.mb-viewer__grid thead .mb-viewer__corner {
  left: 0;
  z-index: 2;
}

.mb-viewer__header-row td {
  background: rgb(var(--v-theme-surface-container-low));
  font-weight: 600;
}

.mb-viewer__grid .mb-viewer__number-cell {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.mb-viewer__empty {
  margin: 0;
  padding: 24px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-viewer__doc {
  width: 100%;
  max-width: 820px;
  height: 100%;
  overflow-y: auto;
  padding: 40px 48px;
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface));
  font-size: 15px;
  line-height: 24px;
}

.mb-viewer__doc :deep(h1) {
  margin: 0 0 16px;
  font-size: 28px;
  line-height: 36px;
}

.mb-viewer__doc :deep(h2) {
  margin: 28px 0 10px;
  font-size: 20px;
  line-height: 28px;
}

.mb-viewer__doc :deep(h3) {
  margin: 20px 0 8px;
  font-size: 16px;
  line-height: 24px;
}

.mb-viewer__doc :deep(p),
.mb-viewer__doc :deep(ul),
.mb-viewer__doc :deep(ol) {
  margin: 0 0 12px;
}

.mb-viewer__doc :deep(table) {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  margin: 8px 0 20px;
  border-collapse: collapse;
  font-size: 14px;
}

.mb-viewer__doc :deep(th),
.mb-viewer__doc :deep(td) {
  padding: 8px 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  text-align: left;
  vertical-align: top;
}

.mb-viewer__doc :deep(th) {
  background: rgb(var(--v-theme-surface-container));
  font-weight: 600;
}

.mb-viewer__doc :deep(tr:nth-child(even) td) {
  background: rgb(var(--v-theme-surface-container-lowest));
}

.mb-viewer__doc :deep(.mb-viewer__task) {
  list-style: none;
  margin-left: -18px;
}

.mb-viewer__doc :deep(.mb-viewer__task input) {
  margin-right: 8px;
  vertical-align: -2px;
  accent-color: rgb(var(--v-theme-link));
}

.mb-viewer__doc :deep(blockquote) {
  margin: 0 0 12px;
  padding: 4px 16px;
  border-left: 3px solid rgb(var(--v-theme-outline-variant));
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-viewer__doc :deep(hr) {
  margin: 24px 0;
  border: 0;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
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

  .mb-viewer__doc {
    padding: 24px 20px;
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
