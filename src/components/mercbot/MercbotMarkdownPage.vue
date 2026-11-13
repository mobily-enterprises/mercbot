<script setup>
import { onMounted, ref } from "vue";
import { checkPageItem, previewUrl } from "./filesApi.js";
import { renderRichText } from "./richText.js";

// An old Markdown page, as it was before pages were HTML (D-74): shown as a document,
// with checklist items as boxes the person ticks; each tick is saved into the page.
const props = defineProps({
  botId: { type: String, required: true },
  group: { type: String, default: null },
  path: { type: String, required: true }
});
const html = ref("");
const problem = ref("");

async function load() {
  try {
    const response = await fetch(previewUrl(props.botId, props.path, props.group), { credentials: "include" });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "This page can't be shown.");
    // Checklist items become real boxes that remember being ticked: each carries its line number.
    const text = String(body.text || "").split("\n")
      .map((line, index) => line.replace(/^(\s*[-*]) \[( |x|X)\] /u, (match, bullet, mark) => `${bullet} ⟦box:${index}:${mark.trim() ? 1 : 0}⟧ `))
      .join("\n");
    html.value = renderRichText(text).replace(/⟦box:(\d+):([01])⟧/gu, (match, line, checked) =>
      `<input type="checkbox" class="mb-md-page__box" data-line="${line}"${checked === "1" ? " checked" : ""} aria-label="Done">`);
  } catch (error) {
    problem.value = error.message || "This page can't be shown right now.";
  }
}

async function toggle(event) {
  const box = event.target;
  if (!(box instanceof HTMLInputElement) || !box.dataset.line) return;
  try {
    await checkPageItem(props.botId, props.path, Number(box.dataset.line), box.checked, props.group);
  } catch {
    box.checked = !box.checked;
  }
}

onMounted(() => load());
</script>

<template>
  <p v-if="problem" class="mb-md-page__problem">{{ problem }}</p>
  <!-- eslint-disable-next-line vue/no-v-html -- markdown-it escapes raw HTML (html: false) -->
  <v-theme-provider v-else theme="light" with-background tag="article" class="mb-md-page" @change="toggle"><div class="mb-rich" v-html="html" /></v-theme-provider>
</template>

<style scoped>
.mb-md-page {
  padding: 32px 40px;
  color: rgb(var(--v-theme-on-surface));
}

.mb-md-page :deep(h1) {
  margin: 0 0 12px;
  font-size: 26px;
  line-height: 32px;
}

.mb-md-page :deep(h2) {
  margin: 24px 0 8px;
  font-size: 18px;
}

.mb-md-page :deep(table) {
  width: 100%;
  border-collapse: collapse;
  margin: 8px 0 16px;
}

.mb-md-page :deep(th),
.mb-md-page :deep(td) {
  padding: 6px 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  text-align: left;
}

.mb-md-page :deep(th) {
  background: rgb(var(--v-theme-surface-container));
}

.mb-md-page :deep(li:has(> .mb-md-page__box)) {
  list-style: none;
  margin-left: -18px;
}

.mb-md-page :deep(.mb-md-page__box) {
  width: 16px;
  height: 16px;
  margin: 0 8px 0 0;
  vertical-align: -3px;
  accent-color: rgb(var(--v-theme-link));
  cursor: pointer;
}

.mb-md-page__problem {
  margin: 0;
  padding: 24px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 14px;
}

@media (max-width: 600px) {
  .mb-md-page {
    padding: 20px 16px;
  }
}
</style>
