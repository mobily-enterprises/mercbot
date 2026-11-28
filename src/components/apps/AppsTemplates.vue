<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { appsApi, errorText } from "./appsApi.js";
import AppTile from "./AppTile.vue";
import { TEMPLATE_AUDIENCES, matchesTemplate } from "./templateFilter.js";

// Ready-made apps (D-35, stage 3). Installing one adds its tables (reusing any this home already
// has) and saves the app as a draft to preview and publish, like any change. Owners and admins
// install; anyone can ask the Builder to install and adapt one.
const emit = defineEmits(["notify"]);
const route = useRoute();
const router = useRouter();
const paths = usePaths();
const templates = ref([]);
// The shared tables every home builds on (D-130): what each is for, what it links to, and whether this home has it.
const sharedTables = ref([]);
const canManage = ref(false);
const loading = ref(true);
const installing = ref("");

// The kind of use and the words looked for are in the address, so coming back to the tab keeps them.
const audience = computed({
  get: () => String(route.query.audience || "all"),
  set: (value) => router.replace({ query: { ...route.query, audience: value === "all" ? undefined : value } })
});
const search = computed({
  get: () => String(route.query.q || ""),
  set: (value) => router.replace({ query: { ...route.query, q: value || undefined } })
});
const countOf = (key) => templates.value.filter((template) => key === "all" || template.audiences.includes(key)).length;
const shown = computed(() => templates.value.filter((template) => matchesTemplate(template, audience.value, search.value)));
const ABILITIES = Object.freeze({
  lines: "Line items",
  board: "Board",
  calendar: "Calendar",
  timeline: "Timeline",
  public: "Public page",
  sends: "Sends email"
});
function clearFilters() {
  router.replace({ query: { ...route.query, audience: undefined, q: undefined } });
}

onMounted(async () => {
  try {
    ({ templates: templates.value, sharedTables: sharedTables.value = [], canManage: canManage.value } = await appsApi.templates());
  } catch (error) {
    emit("notify", errorText(error, "The templates couldn't load."), "error");
  } finally {
    loading.value = false;
  }
});

async function install(template, sample) {
  installing.value = template.key;
  try {
    const { app, errors, skipped } = await appsApi.installTemplate(template.key, sample);
    // The draft opens at once; its frame shows this note (it travels in the history state).
    const notice = errors.length
      ? { text: `${app.name} was added, but its draft needs the Builder: ${errors[0].message}`, color: "error" }
      : { text: `${app.name} is ready as a draft. Preview it, then publish.${skipped ? ` ${skipped} sample record${skipped === 1 ? "" : "s"} didn't fit your existing tables and were left out.` : ""}` };
    router.push({ path: paths.page(`/apps/${app.slug}`), query: { version: "draft" }, state: { notice } });
  } catch (error) {
    emit("notify", errorText(error, "That template couldn't be installed."), "error");
  } finally {
    installing.value = "";
  }
}
</script>

<template>
  <div v-if="loading" class="apps-templates">
    <v-skeleton-loader v-for="index in 6" :key="index" type="card" height="180" />
  </div>
  <div v-else>
    <div class="text-body-2 text-medium-emphasis mb-4">
      {{ canManage ? "Each installs as a draft: its tables are added (or reused if this home has them already), and you preview it before publishing." : "Ask the Builder to install one; the home's owners and admins can install them here." }}
    </div>
    <div class="d-flex flex-wrap align-center ga-3 mb-4">
      <v-chip-group v-model="audience" mandatory aria-label="Kind of use">
        <v-chip value="all" size="small" filter>All ({{ countOf("all") }})</v-chip>
        <v-chip v-for="entry in TEMPLATE_AUDIENCES" :key="entry.key" :value="entry.key" size="small" filter>{{ entry.label }} ({{ countOf(entry.key) }})</v-chip>
      </v-chip-group>
      <v-text-field
        :model-value="search"
        prepend-inner-icon="$search"
        placeholder="Search templates"
        aria-label="Search templates"
        variant="outlined"
        density="compact"
        hide-details
        clearable
        class="apps-templates__search"
        @update:model-value="search = $event || ''"
      />
    </div>
    <div v-if="!shown.length" class="text-body-2 text-on-surface-variant mb-4">
      No templates match.
      <v-btn size="small" variant="text" @click="clearFilters">Clear</v-btn>
    </div>
    <div class="apps-templates">
      <v-card v-for="template in shown" :key="template.key" flat class="pa-4 d-flex flex-column" :data-template="template.key">
        <div class="d-flex align-center ga-3 mb-2">
          <AppTile :icon="template.icon" :color="template.color" :size="44" />
          <span class="text-subtitle-1 apps-templates__name">{{ template.name }}</span>
          <v-chip v-if="template.public" size="x-small" variant="tonal">Public</v-chip>
        </div>
        <div class="text-body-2 mb-2">{{ template.description }}</div>
        <div v-if="template.abilities.length" class="d-flex flex-wrap ga-1 mb-2">
          <v-chip v-for="ability in template.abilities.slice(0, 3)" :key="ability" size="x-small" variant="tonal">{{ ABILITIES[ability] }}</v-chip>
        </div>
        <div v-if="template.needs" class="text-caption text-on-surface-variant mb-2">{{ template.needs }}</div>
        <div class="text-caption text-on-surface-variant mb-3">{{ template.screens }} screens · tables: {{ template.tables.join(", ") }}</div>
        <v-spacer />
        <div v-if="canManage" class="d-flex flex-wrap ga-2">
          <v-btn size="small" variant="flat" color="primary" :disabled="Boolean(installing)" @click="install(template, false)">{{ installing === template.key ? "Installing…" : "Install" }}</v-btn>
          <v-btn v-if="template.sample" size="small" variant="text" :disabled="Boolean(installing)" @click="install(template, true)">With sample data</v-btn>
        </div>
      </v-card>
    </div>
    <section v-if="sharedTables.length" class="mt-8" data-testid="apps-shared-tables">
      <div class="text-subtitle-1 mb-1">Shared tables</div>
      <div class="text-body-2 text-on-surface-variant mb-3">
        Every bot and app keeps its records in these, so there's one list of contacts, to-dos or places for the whole home. A bot adds one the first time it needs it.
      </div>
      <!-- One row per table, its name and whether the home has it above what it's for: it fits a phone's width. -->
      <ul class="apps-shared-tables">
        <li v-for="table in sharedTables" :key="table.key" class="apps-shared-tables__row" :data-shared-table="table.key">
          <div class="d-flex align-center flex-wrap ga-2">
            <router-link v-if="table.inHome" :to="paths.page(`/apps/data/${table.key}`)" class="apps-shared-tables__name">{{ table.label }}</router-link>
            <span v-else class="apps-shared-tables__name">{{ table.label }}</span>
            <v-chip v-if="table.inHome" size="x-small" variant="tonal" color="primary">In this home</v-chip>
            <span v-else class="text-caption text-on-surface-variant">Not added yet</span>
          </div>
          <div class="text-body-2 text-on-surface-variant">
            {{ table.description }}
            <span v-if="table.extends"> One row per record of {{ table.extends }}.</span>
            <span v-else-if="table.linksTo.length"> Links to {{ table.linksTo.join(", ") }}.</span>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.apps-templates {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
.apps-shared-tables {
  list-style: none;
  padding: 0;
  margin: 0;
}
.apps-shared-tables__row {
  padding: 12px 0;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}
/* A table's name reads as the row's title, in on-surface; one the home has opens it, underlined on hover only. */
.apps-shared-tables__name {
  font-size: 14px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface));
  text-decoration: none;
}
a.apps-shared-tables__name:hover,
a.apps-shared-tables__name:focus-visible {
  text-decoration: underline;
  text-decoration-color: rgb(var(--v-theme-outline-variant));
}
.apps-templates__search {
  flex: 1 1 220px;
  max-width: 320px;
}
.apps-templates__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
