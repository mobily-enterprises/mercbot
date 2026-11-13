<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import MarkdownIt from "markdown-it";
import iconUrl from "../../../favicon.svg";
import index from "../../../help/index.json";
import added from "../../../help/extensions.json";
import { closestElement } from "@/browser.js";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import extensions from "@/components/mercbot/extensions.js";
import { helpGroups } from "./helpGroups.js";

// Mercbot's help centre: public, at /help. Pages are Markdown files in help/, in the
// order of help/index.json, then the pages a copy built on Mercbot adds (help/extensions.json, helpGroups.js). Grouped
// navigation at the left, the page in the middle, its outline at the right, and search over every page at the top.
// Each page can be copied for an AI assistant or read as plain text, beside any tools such a copy adds (extensions.js).
const paths = usePaths();
const SOURCES = import.meta.glob("../../../help/*.md", { query: "?raw", import: "default" });
const source = (slug) => SOURCES[`../../../help/${slug}.md`];
const GROUPS = helpGroups(index, added);
const PAGES = GROUPS.flatMap((group) => group.pages.map((page) => ({ ...page, group: group.name })))
  .filter((page) => source(page.slug));

const route = useRoute();
const router = useRouter();
const slug = computed(() => String(route.params.slug || PAGES[0]?.slug || ""));
const page = computed(() => PAGES.find((entry) => entry.slug === slug.value) || null);
const raw = ref("");
const plain = ref(false);
const copied = ref(false);
const article = ref(null);

// Headings get ids from their words, so the outline and links can point at them.
const markdown = new MarkdownIt({ html: false, linkify: true, typographer: true });
const idOf = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/gu, "");
markdown.renderer.rules.heading_open = (tokens, at, options, env, self) => {
  tokens[at].attrSet("id", idOf(tokens[at + 1].content));
  return self.renderToken(tokens, at, options);
};
// A table wider than a phone scrolls in its own box, so the page never scrolls sideways.
markdown.renderer.rules.table_open = () => "<div class=\"mb-help__table\"><table>\n";
markdown.renderer.rules.table_close = () => "</table>\n</div>\n";
const html = computed(() => markdown.render(raw.value.replace(/^# .*\n/u, "")));
const outline = computed(() => [...raw.value.matchAll(/^(##|###) (.+)$/gmu)].map(([, level, text]) => ({ level: level.length, text, id: idOf(text) })));

// The tab's title goes back to what it was when leaving the help centre without a reload.
const titleBefore = document.title;
onBeforeUnmount(() => { document.title = titleBefore; });
watch(slug, async () => {
  plain.value = false;
  raw.value = page.value ? await source(page.value.slug)() : "";
  document.title = page.value ? `${page.value.title} · Mercbot help` : "Mercbot help";
  await nextTick();
  if (route.hash) document.getElementById(route.hash.slice(1))?.scrollIntoView();
  else window.scrollTo(0, 0);
}, { immediate: true });

// Links between help pages stay in the help centre without reloading.
function follow(event) {
  const link = closestElement(event.target, "a");
  const href = link?.getAttribute("href") || "";
  if (href.startsWith("/help")) {
    event.preventDefault();
    router.push(href);
  }
}

async function copyForAi() {
  await navigator.clipboard.writeText(`${raw.value}\n\nSource: ${window.location.origin}/help/${slug.value}\n`);
  copied.value = true;
  setTimeout(() => { copied.value = false; }, 2000);
}

// Search over every page: titles count most, then headings, then the text, with a snippet.
const query = ref("");
const everything = ref(null);
watch(query, async (words) => {
  if (!words.trim() || everything.value) return;
  everything.value = await Promise.all(PAGES.map(async (entry) => ({ ...entry, text: await source(entry.slug)() })));
});
const results = computed(() => {
  const words = query.value.trim().toLowerCase().split(/\s+/u).filter(Boolean);
  if (!words.length || !everything.value) return [];
  return everything.value.map((entry) => {
    const text = entry.text.toLowerCase();
    if (!words.every((word) => text.includes(word) || entry.title.toLowerCase().includes(word))) return null;
    const score = words.reduce((sum, word) => sum + (entry.title.toLowerCase().includes(word) ? 10 : 0) + (text.match(new RegExp(`^#+ .*${word.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&")}`, "gmu"))?.length || 0) * 3 + Math.min(text.split(word).length - 1, 5), 0);
    const at = text.indexOf(words[0]);
    const snippet = entry.text.slice(Math.max(0, at - 60), at + 120).replace(/[#*`[\]]/gu, "").replace(/\s+/gu, " ").trim();
    return { ...entry, score, snippet };
  }).filter(Boolean).sort((a, b) => b.score - a.score).slice(0, 8);
});
function open(entry) {
  query.value = "";
  router.push(paths.page(`/${entry.slug}`));
}
</script>

<template>
  <div class="mb-help">
    <header class="mb-help__bar">
      <router-link :to="paths.page('/')" class="mb-help__brand"><img :src="iconUrl" alt="" width="28" height="28"> Mercbot help</router-link>
      <div class="mb-help__search">
        <label class="mb-help__search-box">
          <v-icon icon="$search" size="18" />
          <input v-model="query" type="search" placeholder="Search the help centre" aria-label="Search the help centre" @keydown.enter="results[0] && open(results[0])">
        </label>
        <ul v-if="query.trim()" class="mb-help__results" role="listbox">
          <li v-for="entry in results" :key="entry.slug" role="option" @mousedown.prevent="open(entry)">
            <strong>{{ entry.title }}</strong>
            <span>{{ entry.snippet }}</span>
          </li>
          <li v-if="everything && !results.length" class="mb-help__no-results">Nothing found</li>
        </ul>
      </div>
      <router-link :to="paths.page('/', { surface: 'start' })" class="mb-help__app">Open Mercbot</router-link>
    </header>
    <div class="mb-help__body">
      <nav class="mb-help__nav" aria-label="Help pages">
        <section v-for="group in GROUPS" :key="group.name">
          <p class="mb-help__group">{{ group.name }}</p>
          <router-link
            v-for="entry in group.pages.filter((item) => source(item.slug))"
            :key="entry.slug"
            :to="paths.page(`/${entry.slug}`)"
            class="mb-help__link"
            :aria-current="entry.slug === slug ? 'page' : undefined"
          >
            {{ entry.title }}
          </router-link>
        </section>
      </nav>
      <main class="mb-help__page">
        <template v-if="page">
          <p class="mb-help__crumb">{{ page.group }}</p>
          <h1 class="mb-help__title">{{ page.title }}</h1>
          <div class="mb-help__tools">
            <button type="button" class="mb-help__tool" @click="copyForAi"><v-icon icon="$contentCopy" size="14" /> {{ copied ? "Copied" : "Copy for AI" }}</button>
            <button type="button" class="mb-help__tool" :aria-pressed="plain" @click="plain = !plain"><v-icon icon="$article" size="14" /> {{ plain ? "Formatted" : "Plain text" }}</button>
            <component :is="tool.component" v-for="(tool, at) in extensions.helpPageTools" :key="at" :page="page" />
          </div>
          <pre v-if="plain" class="mb-help__plain">{{ raw }}</pre>
          <!-- eslint-disable-next-line vue/no-v-html -- the help centre's own Markdown, rendered without HTML -->
          <article v-else ref="article" class="mb-help__article" @click="follow" v-html="html" />
        </template>
        <p v-else class="mb-help__missing">There's no help page here. <router-link :to="paths.page('/')">Start at the beginning</router-link>.</p>
      </main>
      <aside v-if="page && !plain && outline.length" class="mb-help__outline" aria-label="On this page">
        <p class="mb-help__group">On this page</p>
        <a v-for="item in outline" :key="item.id" :href="`#${item.id}`" class="mb-help__outline-link" :class="{ 'mb-help__outline-link--sub': item.level === 3 }">{{ item.text }}</a>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.mb-help {
  min-height: 100vh;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-surface));
}

.mb-help__bar {
  position: sticky;
  top: 0;
  z-index: 2;
  display: flex;
  align-items: center;
  gap: 24px;
  height: 60px;
  padding: 0 24px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  background: rgb(var(--v-theme-background));
}

.mb-help__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
  white-space: nowrap;
}

.mb-help__brand img {
  border-radius: 8px;
}

.mb-help__search {
  position: relative;
  flex: 1;
  min-width: 0;
  max-width: 520px;
}

.mb-help__search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 38px;
  padding: 0 14px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 19px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-help__search-box input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 14px;
}

.mb-help__results {
  position: absolute;
  top: 44px;
  left: 0;
  right: 0;
  margin: 0;
  padding: 6px;
  list-style: none;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 8px 28px rgba(var(--v-theme-shadow), 0.14);
}

.mb-help__results li {
  display: flex;
  flex-direction: column;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 14px;
  cursor: pointer;
}

.mb-help__results li:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-help__results span {
  overflow: hidden;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-help__results .mb-help__no-results {
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: default;
}

.mb-help__app {
  margin-left: auto;
  padding: 7px 14px;
  border-radius: 16px;
  background: rgb(var(--v-theme-on-surface));
  color: rgb(var(--v-theme-surface));
  font-size: 13px;
  text-decoration: none;
  white-space: nowrap;
}

.mb-help__body {
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr) 210px;
  gap: 32px;
  max-width: 1280px;
  margin: 0 auto;
  padding: 0 24px;
}

.mb-help__nav,
.mb-help__outline {
  position: sticky;
  top: 60px;
  align-self: start;
  max-height: calc(100vh - 60px);
  overflow-y: auto;
  padding: 24px 0;
}

.mb-help__group {
  margin: 16px 0 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-help__link {
  display: block;
  padding: 5px 10px;
  border-radius: 8px;
  color: inherit;
  font-size: 14px;
  line-height: 20px;
  text-decoration: none;
}

.mb-help__link:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-help__link[aria-current="page"] {
  background: rgb(var(--v-theme-surface-variant));
  font-weight: 600;
}

.mb-help__page {
  min-width: 0;
  padding: 32px 0 96px;
}

.mb-help__crumb {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-help__title {
  margin: 4px 0 14px;
  font-size: 32px;
  line-height: 40px;
  font-weight: 700;
}

.mb-help__tools {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 24px;
}

.mb-help__tool {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 15px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-decoration: none;
  cursor: pointer;
}

.mb-help__plain {
  white-space: pre-wrap;
  font-size: 13px;
  line-height: 20px;
}

.mb-help__article {
  font-size: 15px;
  line-height: 25px;
}

.mb-help__article :deep(h2) {
  margin: 36px 0 10px;
  font-size: 22px;
  line-height: 30px;
  scroll-margin-top: 76px;
}

.mb-help__article :deep(h3) {
  margin: 24px 0 6px;
  font-size: 17px;
  scroll-margin-top: 76px;
}

.mb-help__article :deep(p),
.mb-help__article :deep(ul),
.mb-help__article :deep(ol) {
  margin: 0 0 14px;
}

.mb-help__article :deep(li) {
  margin-bottom: 4px;
}

.mb-help__article :deep(a) {
  color: rgb(var(--v-theme-link));
}

.mb-help__article :deep(code) {
  padding: 1px 5px;
  border-radius: 5px;
  background: rgb(var(--v-theme-surface-variant));
  font-size: 13px;
}

.mb-help__article :deep(.mb-help__table) {
  margin: 0 0 18px;
  overflow-x: auto;
}

.mb-help__article :deep(table) {
  width: 100%;
  border-collapse: collapse;
  font-size: 14px;
}

.mb-help__article :deep(th),
.mb-help__article :deep(td) {
  padding: 8px 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  text-align: left;
  vertical-align: top;
}

.mb-help__article :deep(th) {
  background: rgb(var(--v-theme-surface-variant));
}

.mb-help__outline-link {
  display: block;
  padding: 3px 0;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 13px;
  line-height: 19px;
  text-decoration: none;
}

.mb-help__outline-link--sub {
  padding-left: 12px;
}

.mb-help__outline-link:hover {
  color: rgb(var(--v-theme-on-surface));
}

.mb-help__missing {
  margin-top: 48px;
}

@media (max-width: 1100px) {
  .mb-help__body {
    grid-template-columns: 230px minmax(0, 1fr);
  }

  .mb-help__outline {
    display: none;
  }
}

@media (max-width: 760px) {
  .mb-help__body {
    grid-template-columns: minmax(0, 1fr);
  }

  /* The page comes first, and the list of pages after it. */
  .mb-help__page {
    order: -1;
    padding-bottom: 32px;
  }

  .mb-help__nav {
    position: static;
    max-height: none;
    padding-top: 0;
    border-top: 1px solid rgb(var(--v-theme-outline-variant));
  }

  .mb-help__app {
    display: none;
  }
}
</style>
