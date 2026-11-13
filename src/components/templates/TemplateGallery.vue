<script setup>
import { computed, onMounted, ref } from "vue";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import iconUrl from "../../../favicon.svg";
import TemplateAvatar from "./TemplateAvatar.vue";
import TemplateTested from "./TemplateTested.vue";
import { templatesApi } from "./templatesApi.js";

// The bot template gallery (D-43): public, curated by the Mercbot team. Chips pick a job
// area, search finds a bot or creator, four featured cards lead, then a section per area. Every
// template carries its honest badge: "Tested <date>" or "Not tested yet" (D-79).
const SECTION_SIZE = 6;
const paths = usePaths();
const shareLink = (slug) => paths.page(`/${encodeURIComponent(slug)}`, { surface: "share" });
const gallery = ref(null);
const failed = ref(false);
const chip = ref("all");
const query = ref("");

onMounted(async () => {
  try {
    gallery.value = await templatesApi.gallery();
  } catch {
    failed.value = true;
  }
});

const templates = computed(() => gallery.value?.templates || []);
const chips = computed(() => [
  { id: "all", name: "All" },
  { id: "team", name: "Mercbot team" },
  ...(gallery.value?.categories || []).filter((category) => templates.value.some((entry) => entry.category === category.id))
]);
const featured = computed(() => {
  const picked = templates.value.filter((entry) => entry.featured);
  return [...picked, ...templates.value.filter((entry) => !entry.featured)].slice(0, 4);
});
const found = computed(() => {
  const words = query.value.trim().toLowerCase();
  if (!words) return null;
  return templates.value.filter((entry) => `${entry.name} ${entry.creator} ${entry.description}`.toLowerCase().includes(words));
});
// The sections shown: every area under All (a few rows each), or one area in full.
const sections = computed(() => {
  const areas = (gallery.value?.categories || []).map((category) => ({ ...category, rows: templates.value.filter((entry) => entry.category === category.id) }));
  if (chip.value === "all") return areas.filter((area) => area.rows.length).map((area) => ({ ...area, more: area.rows.length > SECTION_SIZE, rows: area.rows.slice(0, SECTION_SIZE) }));
  if (chip.value === "team") return [{ id: "team", name: "From the Mercbot team", rows: templates.value.filter((entry) => entry.team) }];
  return areas.filter((area) => area.id === chip.value);
});
</script>

<template>
  <div class="mb-gallery">
    <header class="mb-gallery__bar">
      <router-link :to="paths.page('/', { surface: 'start' })" class="mb-gallery__brand"><img :src="iconUrl" alt="" width="28" height="28"> Mercbot</router-link>
    </header>
    <main class="mb-gallery__main">
      <h1 class="mb-gallery__title">Bot templates</h1>
      <p class="mb-gallery__lead">Ready-made bots for one job each. Every one starts by asking about you, and asks before it sends anything.</p>

      <nav class="mb-gallery__chips" aria-label="Job areas">
        <button
          v-for="entry in chips"
          :key="entry.id"
          type="button"
          class="mb-gallery__chip"
          :aria-pressed="chip === entry.id"
          @click="chip = entry.id; query = ''"
        >
          {{ entry.name }}
        </button>
      </nav>
      <label class="mb-gallery__search">
        <v-icon icon="$search" size="18" />
        <input v-model="query" type="search" placeholder="Search by bot or creator" aria-label="Search templates">
      </label>

      <p v-if="failed" class="mb-gallery__empty">The templates couldn't be loaded. Try again in a moment.</p>
      <p v-else-if="!gallery" class="mb-gallery__empty">Loading templates…</p>

      <template v-else-if="found">
        <h2 class="mb-gallery__section-title">{{ found.length ? `Found ${found.length}` : "Nothing found" }}</h2>
        <div class="mb-gallery__rows">
          <router-link v-for="entry in found" :key="entry.slug" class="mb-gallery__row" :to="paths.page(`/${entry.slug}`)">
            <TemplateAvatar :template="entry" :size="40" />
            <span class="mb-gallery__row-text">
              <span class="mb-gallery__row-head"><strong>{{ entry.name }}</strong> <span class="mb-gallery__by">by {{ entry.creator }}</span> <TemplateTested :template="entry" /></span>
              <span class="mb-gallery__description">{{ entry.description }}</span>
            </span>
            <router-link class="mb-gallery__add" :to="shareLink(entry.slug)" @click.stop>Add</router-link>
          </router-link>
        </div>
      </template>

      <template v-else>
        <section v-if="chip === 'all'" class="mb-gallery__featured" aria-label="Featured">
          <router-link v-for="entry in featured" :key="entry.slug" class="mb-gallery__card" :to="paths.page(`/${entry.slug}`)">
            <TemplateAvatar :template="entry" :size="88" />
            <span class="mb-gallery__card-name" :style="{ color: entry.color }">{{ entry.name }}</span>
            <span class="mb-gallery__by">by {{ entry.creator }}</span>
            <TemplateTested :template="entry" />
          </router-link>
        </section>
        <section v-for="section in sections" :key="section.id" class="mb-gallery__section">
          <div class="mb-gallery__section-head">
            <h2 class="mb-gallery__section-title">{{ section.name }}</h2>
            <button v-if="section.more" type="button" class="mb-gallery__view-all" @click="chip = section.id">View all</button>
          </div>
          <div class="mb-gallery__rows">
            <router-link v-for="entry in section.rows" :key="entry.slug" class="mb-gallery__row" :to="paths.page(`/${entry.slug}`)">
              <TemplateAvatar :template="entry" :size="40" />
              <span class="mb-gallery__row-text">
                <span class="mb-gallery__row-head"><strong>{{ entry.name }}</strong> <span class="mb-gallery__by">by {{ entry.creator }}</span> <TemplateTested :template="entry" /></span>
                <span class="mb-gallery__description">{{ entry.description }}</span>
              </span>
              <router-link class="mb-gallery__add" :to="shareLink(entry.slug)" @click.stop>Add</router-link>
            </router-link>
          </div>
        </section>
      </template>
    </main>
  </div>
</template>

<style scoped>
.mb-gallery {
  min-height: 100vh;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-surface));
}

.mb-gallery__bar {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 24px;
}

.mb-gallery__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}

.mb-gallery__brand img {
  border-radius: 8px;
}

.mb-gallery__main {
  max-width: 980px;
  margin: 0 auto;
  padding: 24px 24px 80px;
}

.mb-gallery__title {
  margin: 0;
  font-size: 34px;
  line-height: 42px;
  font-weight: 700;
}

.mb-gallery__lead {
  margin: 8px 0 20px;
  font-size: 15px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-gallery__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.mb-gallery__chip {
  height: 32px;
  padding: 0 14px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 16px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mb-gallery__chip[aria-pressed="true"] {
  border-color: rgb(var(--v-theme-on-surface));
  background: rgb(var(--v-theme-on-surface));
  color: rgb(var(--v-theme-surface));
}

.mb-gallery__search {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 44px;
  margin: 16px 0 28px;
  padding: 0 16px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 22px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-gallery__search input {
  flex: 1;
  min-width: 0;
  border: 0;
  outline: none;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 15px;
}

.mb-gallery__featured {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 16px;
  margin-bottom: 36px;
}

.mb-gallery__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  padding: 28px 12px 20px;
  border-radius: 18px;
  background: rgb(var(--v-theme-surface-variant));
  color: inherit;
  text-align: center;
  text-decoration: none;
}

.mb-gallery__card-name {
  margin-top: 10px;
  font-size: 16px;
  font-weight: 600;
}

.mb-gallery__section {
  margin-bottom: 32px;
}

.mb-gallery__section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.mb-gallery__section-title {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
}

.mb-gallery__view-all {
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mb-gallery__rows {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 4px 24px;
}

.mb-gallery__row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-width: 0;
  padding: 10px 8px;
  border-radius: 12px;
  color: inherit;
  text-decoration: none;
}

.mb-gallery__row:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-gallery__row-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 2px 6px;
}

.mb-gallery__row-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  font-size: 14px;
}

.mb-gallery__by {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-gallery__description {
  overflow: hidden;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-gallery__add {
  flex: none;
  padding: 5px 14px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-container-high));
  color: inherit;
  font-size: 13px;
  font-weight: 500;
  text-decoration: none;
}

.mb-gallery__empty {
  color: rgb(var(--v-theme-on-surface-variant));
}

@media (max-width: 720px) {
  .mb-gallery__featured {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .mb-gallery__rows {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
