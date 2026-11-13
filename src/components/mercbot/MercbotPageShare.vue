<script setup>
import { computed, inject, ref, watch } from "vue";
import extensions from "./extensions.js";
import { fileUrl, isHtmlPage, previewUrl } from "./filesApi.js";
import { MERCBOT_INITIALS_KEY } from "./shellInitials.js";
import WEBSITE_PARTS from "./websiteParts.js";

// A page's Share (D-74), from the page's viewer or the Library. A web page is the
// home's: everyone in it can open it, like every file there; what a copy built on Mercbot adds to the
// Share (extensions.js, pageShareParts) shows under that. An older Markdown page shows who can open it
// by where its file is kept (`access`, useBotLibrary's pageAccess), with its words to copy or its file
// to download. A web page also shows its place on the home's own website (D-84), when that part is in.
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({
  botId: { type: String, required: true },
  path: { type: String, required: true },
  title: { type: String, required: true },
  // Who can open an older Markdown page: { icon, title, text, onlyYou }.
  access: { type: Object, default: null },
  displayName: { type: String, default: "" }
});
const emit = defineEmits(["copied", "failure"]);
/** @type {import("vue").Ref<string>} */
const initials = inject(MERCBOT_INITIALS_KEY, ref(""));

const html = computed(() => isHtmlPage(props.path));
// The added parts this person sees, asked each time the Share of a web page opens; a failed answer hides the part.
const parts = ref([]);
watch(open, async (now) => {
  parts.value = [];
  if (!now || !html.value) return;
  const answers = await Promise.all(extensions.pageShareParts.map((part) => (part.visible ? part.visible().catch(() => false) : true)));
  if (open.value) parts.value = extensions.pageShareParts.filter((_part, at) => answers[at]);
}, { immediate: true });

/** A Markdown page's words, read while the clipboard waits, so the copy still counts as the person's click. */
async function pageText() {
  const response = await fetch(previewUrl(props.botId, props.path), { credentials: "include" });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || "The page didn't load.");
  return new Blob([String(body.text || "")], { type: "text/plain" });
}

async function copyText() {
  try {
    await navigator.clipboard.write([new ClipboardItem({ "text/plain": pageText() })]);
    emit("copied", "Page copied");
  } catch (error) {
    emit("failure", error);
  }
}
</script>

<template>
  <v-dialog v-model="open" width="420" scrim="scrim" :opacity="0.3">
    <section class="mb-page-share" :aria-label="`Share ${title}`">
      <div class="mb-page-share__top">
        <h2 class="mb-page-share__title">Share “{{ title }}”</h2>
        <button type="button" class="mb-page-share__close" aria-label="Close" @click="open = false">
          <v-icon icon="$close" size="18" />
        </button>
      </div>

      <template v-if="html">
        <div class="mb-page-share__row">
          <span class="mb-page-share__glyph"><v-icon icon="$home" size="18" /></span>
          <span class="mb-page-share__text">
            <span class="mb-page-share__name">Everyone in this home</span>
            <span class="mb-page-share__note">Can open it, like every file in the home</span>
          </span>
        </div>
        <template v-if="open">
          <component :is="part.component" v-for="(part, at) in parts" :key="at" :bot-id="botId" :path="path" @copied="emit('copied', $event)" />
        </template>
        <component :is="WEBSITE_PARTS.pageShare" v-if="WEBSITE_PARTS.pageShare && open" :bot-id="botId" :path="path" @copied="emit('copied', $event)" />
      </template>

      <template v-else-if="access">
        <div v-if="access.onlyYou" class="mb-page-share__row">
          <span class="mb-page-share__glyph" aria-hidden="true">{{ initials }}</span>
          <span class="mb-page-share__text">{{ displayName || "You" }} (you)</span>
          <span class="mb-page-share__note">Owner</span>
        </div>
        <p class="mb-page-share__label">Who can open it</p>
        <div class="mb-page-share__access" role="radiogroup" aria-label="Who can open it">
          <div class="mb-page-share__row" role="radio" aria-checked="true">
            <span class="mb-page-share__glyph"><v-icon :icon="access.icon" size="18" /></span>
            <span class="mb-page-share__text">
              <span class="mb-page-share__name">{{ access.title }}</span>
              <span class="mb-page-share__note">{{ access.text }}</span>
            </span>
            <v-icon icon="$check" size="18" class="mb-page-share__check" />
          </div>
        </div>
        <div class="mb-page-share__actions mb-page-share__actions--even">
          <button type="button" class="mb-page-share__button" @click="copyText">
            <v-icon icon="$contentCopy" size="16" /> Copy text
          </button>
          <a class="mb-page-share__button" :href="fileUrl(botId, path)" :download="`${title}.md`">
            <v-icon icon="$download" size="16" /> Download
          </a>
        </div>
      </template>
    </section>
  </v-dialog>
</template>

<style scoped>
.mb-page-share {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 16px 20px 20px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-page-share__top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mb-page-share__title {
  flex: 1;
  min-width: 0;
  margin: 0;
  overflow: hidden;
  font-size: 15px;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-page-share__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-page-share__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}

.mb-page-share__glyph {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
  font-weight: 600;
}

.mb-page-share__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  font-size: 13px;
}

.mb-page-share__name {
  font-size: 14px;
  font-weight: 500;
}

.mb-page-share__note {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}

.mb-page-share__label {
  margin: 4px 0 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
  font-weight: 600;
}

.mb-page-share__access {
  padding: 6px 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
}

.mb-page-share__check {
  color: rgb(var(--v-theme-link));
}

.mb-page-share__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.mb-page-share__actions--even {
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.mb-page-share__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 17px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-decoration: none;
  cursor: pointer;
}

</style>
