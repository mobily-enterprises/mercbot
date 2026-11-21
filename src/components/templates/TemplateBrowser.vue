<script setup>
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import TemplateAvatar from "./TemplateAvatar.vue";
import TemplateTested from "./TemplateTested.vue";
import MercbotTemplateTag from "../mercbot/MercbotTemplateTag.vue";
import { templatesApi } from "./templatesApi.js";
import { galleryChips, galleryView } from "./galleryView.js";

// Browsing the bot template gallery (D-43, D-98), the one gallery both the public page (TemplateGallery.vue) and the
// template pickers show: search finds a bot, tag or creator, chips pick a job area, four featured cards lead, then a
// section per area, each template with its tag, its honest badge (D-79) and a cloud that looks at you when you point at
// it. On the page a template opens its own page and Add its share page. In a picker (`picking`) a template is a button
// that picks it ({ library: slug }, or { home: id } for one of `home`, the home's own, listed first): the search box has
// the keyboard first, the arrows move through the templates in reading order (Up from the first goes back to the
// search), and Enter picks the one focused, or the first found from the search box. A picker's `lead` slot comes first
// and its `foot` slot last. A picker is calmer (D-109): an area menu in place of the chips, no featured cards, no
// byline, and only a passed check's badge, since nearly every template is the Mercbot team's and untested; a
// template's preview still shows its honest badge.
const props = defineProps({
  picking: { type: Boolean, default: false },
  // The home's own templates (id, tag, description, usedBy), in a picker; null on the page.
  home: { type: Array, default: null }
});
const emit = defineEmits(["pick"]);
const paths = usePaths();
const gallery = ref(null);
const failed = ref(false);
const chip = ref("all");
const query = ref("");
// The template pointed at or focused, whose cloud looks at you.
const looking = ref("");
const search = ref(null);
const list = ref(null);

async function load() {
  failed.value = false;
  try {
    gallery.value = await templatesApi.gallery();
  } catch {
    failed.value = true;
  }
}
onMounted(load);

const chips = computed(() => galleryChips(gallery.value, { picking: props.picking }));
const view = computed(() => galleryView(gallery.value, { chip: chip.value, query: query.value, home: props.home, picking: props.picking }));
// A library template's tag, as a bot of it shows it.
const tagOf = (template) => ({ template: { tag: template.tag, source: "library", description: template.description } });
const choiceOf = (template) => (template.home ? { home: template.id } : { library: template.slug });

function choose(id) {
  chip.value = id;
  query.value = "";
  if (list.value) list.value.scrollTop = 0;
}

// Under the page's title the sections are its second level; in a picker, under the dialog's own.
const heading = computed(() => (props.picking ? "h3" : "h2"));
// A template on the page opens its page; in a picker it's a button that picks it.
const entryTag = computed(() => (props.picking ? "button" : RouterLink));
const entryOf = (template) => (props.picking
  ? { type: "button", onClick: () => emit("pick", choiceOf(template)) }
  : { to: paths.page(`/${encodeURIComponent(template.slug)}`) });
const shareLink = (slug) => paths.page(`/${encodeURIComponent(slug)}`, { surface: "share" });

function moveFocus(step) {
  const entries = [...(list.value?.querySelectorAll("[data-template-entry]") || [])];
  const at = entries.indexOf(document.activeElement);
  const next = at === -1 ? (step > 0 ? 0 : -1) : at + step;
  const target = next < 0 ? search.value : entries[Math.min(next, entries.length - 1)];
  target?.focus({ preventScroll: true });
  if (target !== search.value) target?.scrollIntoView({ block: "nearest" });
}

function onKeydown(event) {
  if (!props.picking || event.altKey || event.ctrlKey || event.metaKey) return;
  const inSearch = event.target === search.value;
  const onEntry = event.target instanceof Element && Boolean(event.target.closest("[data-template-entry]"));
  const forward = event.key === "ArrowDown" || (onEntry && event.key === "ArrowRight");
  const back = event.key === "ArrowUp" || (onEntry && event.key === "ArrowLeft");
  if ((inSearch || onEntry) && (forward || back)) {
    event.preventDefault();
    moveFocus(forward ? 1 : -1);
  } else if (inSearch && event.key === "Enter" && view.value.order.length) {
    event.preventDefault();
    emit("pick", choiceOf(view.value.order[0].template));
  }
}

/** How many of the home's bots use one of its templates. */
const usedText = (template) => (template.usedBy === 1 ? "Used by 1 bot" : `Used by ${template.usedBy || 0} bots`);

defineExpose({ focusSearch: () => search.value?.focus(), searchWords: () => query.value.trim() });
</script>

<template>
  <div class="mb-tbrowse" :class="{ 'mb-tbrowse--picking': picking }" @keydown="onKeydown">
    <label class="mb-tbrowse__search">
      <v-icon icon="$search" :size="picking ? 16 : 18" />
      <input ref="search" v-model="query" type="search" :placeholder="picking ? 'Search bots' : 'Search by bot, tag or creator'" aria-label="Search templates">
    </label>
    <select v-if="picking" class="mb-tbrowse__area" :value="chip" aria-label="Area" @change="choose($event.target.value)">
      <option v-for="entry in chips" :key="entry.id" :value="entry.id">{{ entry.name }}</option>
    </select>
    <nav v-else class="mb-tbrowse__chips" aria-label="Job areas">
      <button v-for="entry in chips" :key="entry.id" type="button" class="mb-tbrowse__chip" :aria-pressed="chip === entry.id" @click="choose(entry.id)">
        {{ entry.name }}
      </button>
    </nav>

    <div ref="list" class="mb-tbrowse__list">
      <div v-if="failed" class="mb-tbrowse__state" role="alert">
        <v-icon icon="$errorFilled" size="28" />
        <p>The templates couldn't be loaded.</p>
        <button type="button" class="mb-set-pill" @click="load">Try again</button>
      </div>
      <div v-else-if="!gallery" class="mb-tbrowse__loading" aria-label="Loading templates" role="status">
        <div v-if="!picking" class="mb-tbrowse__featured">
          <span v-for="index in 4" :key="index" class="mb-tbrowse__card mb-tbrowse__skeleton-card"><span class="mb-tbrowse__skeleton-face" /><span class="mb-tbrowse__skeleton-bar" /></span>
        </div>
        <div class="mb-tbrowse__rows">
          <span v-for="index in 6" :key="index" class="mb-tbrowse__row">
            <span class="mb-tbrowse__skeleton-face mb-tbrowse__skeleton-face--row" />
            <span class="mb-tbrowse__row-text">
              <span class="mb-tbrowse__skeleton-bar" :style="{ width: `${[52, 64, 44, 58, 48, 60][index - 1]}%` }" />
              <span class="mb-tbrowse__skeleton-bar mb-tbrowse__skeleton-bar--thin" :style="{ width: `${[78, 70, 84, 66, 74, 80][index - 1]}%` }" />
            </span>
          </span>
        </div>
      </div>

      <template v-else>
        <!-- A picker's own first choice, before every template (Add bots' General helper). -->
        <slot v-if="!view.found" name="lead" />
        <!-- The home's own templates (D-98), first in a picker: a tag and a line each, no look of their own. -->
        <section v-if="view.home.length" class="mb-tbrowse__section" aria-label="Your home's templates">
          <div class="mb-tbrowse__section-head">
            <component :is="heading" class="mb-tbrowse__section-title">Your home's templates</component>
          </div>
          <div class="mb-tbrowse__rows">
            <button
              v-for="entry in view.home"
              :key="entry.key"
              v-bind="entryOf(entry.template)"
              class="mb-tbrowse__row"
              data-template-entry
            >
              <span class="mb-tbrowse__home-face"><v-icon icon="$home" size="20" /></span>
              <span class="mb-tbrowse__row-text">
                <span class="mb-tbrowse__row-head"><strong>{{ entry.template.tag }}</strong> <span class="mb-tbrowse__by">{{ usedText(entry.template) }}</span></span>
                <span class="mb-tbrowse__description">{{ entry.template.description }}</span>
              </span>
              <v-icon icon="$chevronRight" size="18" class="mb-tbrowse__open" />
            </button>
          </div>
        </section>
        <section v-if="view.featured.length" class="mb-tbrowse__featured" aria-label="Featured">
          <component
            :is="entryTag"
            v-for="entry in view.featured"
            :key="entry.key"
            v-bind="entryOf(entry.template)"
            class="mb-tbrowse__card"
            data-template-entry
            @mouseenter="looking = entry.key"
            @mouseleave="looking = ''"
            @focus="looking = entry.key"
            @blur="looking = ''"
          >
            <TemplateAvatar :template="entry.template" :size="88" :state="looking === entry.key ? 'hover' : 'idle'" />
            <span class="mb-tbrowse__card-name" :style="{ color: entry.template.color }">{{ entry.template.name }}</span>
            <MercbotTemplateTag v-if="entry.template.tag" :bot="tagOf(entry.template)" :tooltip="false" />
            <span class="mb-tbrowse__by">by {{ entry.template.creator }}</span>
            <TemplateTested :template="entry.template" />
          </component>
        </section>
        <component :is="heading" v-if="view.found" class="mb-tbrowse__section-title">{{ view.found.length ? `Found ${view.found.length}` : "Nothing found" }}</component>
        <section v-for="section in view.found ? [{ id: 'found', rows: view.found }] : view.sections" :key="section.id" class="mb-tbrowse__section" :aria-label="section.name">
          <div v-if="section.name" class="mb-tbrowse__section-head">
            <component :is="heading" class="mb-tbrowse__section-title">{{ section.name }}</component>
            <button v-if="section.more" type="button" class="mb-tbrowse__view-all" @click="choose(section.id)">View all</button>
          </div>
          <div class="mb-tbrowse__rows">
            <component
              :is="entryTag"
              v-for="entry in section.rows"
              :key="entry.key"
              v-bind="entryOf(entry.template)"
              class="mb-tbrowse__row"
              data-template-entry
              @mouseenter="looking = entry.key"
              @mouseleave="looking = ''"
              @focus="looking = entry.key"
              @blur="looking = ''"
            >
              <span v-if="entry.template.home" class="mb-tbrowse__home-face"><v-icon icon="$home" size="20" /></span>
              <TemplateAvatar v-else :template="entry.template" :size="40" :state="looking === entry.key ? 'hover' : 'idle'" />
              <span v-if="entry.template.home" class="mb-tbrowse__row-text">
                <span class="mb-tbrowse__row-head"><strong>{{ entry.template.tag }}</strong> <span class="mb-tbrowse__by">Your home's · {{ usedText(entry.template) }}</span></span>
                <span class="mb-tbrowse__description">{{ entry.template.description }}</span>
              </span>
              <span v-else class="mb-tbrowse__row-text">
                <span class="mb-tbrowse__row-head">
                  <strong>{{ entry.template.name }}</strong>
                  <MercbotTemplateTag v-if="entry.template.tag" :bot="tagOf(entry.template)" :tooltip="false" />
                  <span v-if="!picking" class="mb-tbrowse__by">by {{ entry.template.creator }}</span>
                  <TemplateTested v-if="!picking || entry.template.tested" :template="entry.template" />
                </span>
                <span class="mb-tbrowse__description">{{ entry.template.description }}</span>
              </span>
              <v-icon v-if="picking" icon="$chevronRight" size="18" class="mb-tbrowse__open" />
              <RouterLink v-else class="mb-tbrowse__add" :to="shareLink(entry.template.slug)" @click.stop>Add</RouterLink>
            </component>
          </div>
        </section>
        <slot name="foot" />
      </template>
    </div>
  </div>
</template>

<style scoped>
/* The gallery's own width (a container query) chooses its columns, on the page and in a picker alike. */
.mb-tbrowse {
  container: mb-tbrowse / inline-size;
}

/* In a picker the search and area menu stay put and the templates scroll under them, the scroll bar at the dialog's edge:
   the dialog gives its side margin as --mb-tbrowse-gutter. */
.mb-tbrowse--picking {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.mb-tbrowse--picking .mb-tbrowse__list {
  flex: 1;
  padding: 4px var(--mb-tbrowse-gutter, 24px) 24px;
  overflow-y: auto;
}

.mb-tbrowse__search {
  display: flex;
  flex: none;
  align-items: center;
  gap: 8px;
  height: 44px;
  padding: 0 16px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 22px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tbrowse__search:focus-within {
  border-color: rgb(var(--v-theme-outline));
}

.mb-tbrowse__search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 15px;
}

.mb-tbrowse__chips {
  display: flex;
  flex: none;
  flex-wrap: wrap;
  gap: 8px;
  margin: 16px 0 28px;
}

.mb-tbrowse__chip {
  height: 32px;
  padding: 0 14px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 16px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
}

.mb-tbrowse__chip[aria-pressed="true"] {
  border-color: rgb(var(--v-theme-on-surface));
  background: rgb(var(--v-theme-on-surface));
  color: rgb(var(--v-theme-surface));
}

/* In a picker, the search of the app's other gallery, Connect apps (MercbotAppsModal.css). */
.mb-tbrowse--picking .mb-tbrowse__search {
  height: 32px;
  margin: 0 var(--mb-tbrowse-gutter, 24px);
  padding: 0 12px;
  border-radius: 16px;
}

.mb-tbrowse--picking .mb-tbrowse__search input {
  font-size: 13px;
}

/* A picker's area menu, under its search, as small as Connect apps' chips. */
.mb-tbrowse__area {
  flex: none;
  align-self: flex-start;
  height: 28px;
  margin: 12px var(--mb-tbrowse-gutter, 24px) 16px;
  padding: 0 12px;
  border: 0;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-container-high));
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mb-tbrowse__area:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}

.mb-tbrowse__featured {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 36px;
}

.mb-tbrowse__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
  padding: 28px 12px 20px;
  border: 0;
  border-radius: 18px;
  background: rgb(var(--v-theme-surface-variant));
  color: inherit;
  font: inherit;
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  transition: box-shadow var(--md-sys-motion-duration-short4) var(--md-sys-motion-easing-standard);
}

.mb-tbrowse__card:hover {
  box-shadow: inset 0 0 0 1px rgb(var(--v-theme-outline-variant));
}

.mb-tbrowse__card-name {
  margin-top: 10px;
  font-size: 16px;
  font-weight: 600;
}

.mb-tbrowse__section {
  margin-bottom: 32px;
}

.mb-tbrowse--picking .mb-tbrowse__section {
  margin-bottom: 24px;
}

.mb-tbrowse__section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.mb-tbrowse__section-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
}

.mb-tbrowse--picking .mb-tbrowse__section-title {
  margin-bottom: 8px;
  font-size: 15px;
}

.mb-tbrowse__view-all {
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mb-tbrowse__rows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 24px;
}

.mb-tbrowse--picking .mb-tbrowse__rows {
  gap: 2px 12px;
}

.mb-tbrowse__row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px 8px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  text-decoration: none;
  cursor: pointer;
}

.mb-tbrowse__row:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-tbrowse__card:focus-visible,
.mb-tbrowse__row:focus-visible,
.mb-tbrowse__chip:focus-visible,
.mb-tbrowse__view-all:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}

/* One of the home's own templates (D-98): no look of its own, so a house where a template's cloud would be. */
.mb-tbrowse__home-face {
  display: grid;
  flex: none;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tbrowse__row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
}

.mb-tbrowse__row-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  font-size: 14px;
}

.mb-tbrowse__by {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tbrowse__description {
  overflow: hidden;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-tbrowse__add {
  flex: none;
  padding: 5px 14px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-container-high));
  color: inherit;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
}

.mb-tbrowse__open {
  flex: none;
  color: rgb(var(--v-theme-on-surface-variant));
}

/* Loading: the cards and rows' own shapes, in tone, so nothing moves when the templates come. */
.mb-tbrowse__skeleton-face {
  width: 88px;
  height: 88px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-tbrowse__skeleton-face--row {
  flex: none;
  width: 40px;
  height: 40px;
}

.mb-tbrowse__skeleton-bar {
  display: block;
  width: 60%;
  height: 12px;
  margin-top: 16px;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-tbrowse__row .mb-tbrowse__skeleton-bar {
  margin: 4px 0;
}

.mb-tbrowse__skeleton-bar--thin {
  height: 8px;
}

.mb-tbrowse__loading {
  pointer-events: none;
}

.mb-tbrowse__state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  padding: 48px 16px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 14px;
  text-align: center;
}

.mb-tbrowse__state p {
  margin: 0;
}

@container mb-tbrowse (max-width: 600px) {
  .mb-tbrowse__featured {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mb-tbrowse__rows {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
