<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import ShellUpButton from "@jskit-ai/shell-web/client/components/ShellUpButton";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import SelectField from "@jskit-ai/http-web/client/components/SelectField";
import { botsApi } from "@/components/mercbot/botsApi.js";
import AppsActivity from "./AppsActivity.vue";
import AppsLook from "./AppsLook.vue";
import AppsScripts from "./AppsScripts.vue";
import AppsTemplates from "./AppsTemplates.vue";
import { appsApi } from "./appsApi.js";
import { ICON_PATHS } from "./appRuntime.js";
import { useSnackbar } from "./useSnackbar.js";

// The Apps area of a home (D-35): its apps, its tables and everything that changed.
// New app opens the Builder's chat; if there's no Builder yet, the person picks one.
const route = useRoute();
const router = useRouter();
const paths = usePaths();
const tab = computed({
  get: () => (["apps", "data", "activity", "templates", "scripts", "look"].includes(route.query.tab) ? route.query.tab : "apps"),
  set: (value) => router.replace({ query: { ...route.query, tab: value === "apps" ? undefined : value } })
});

const state = reactive({ loading: true, apps: [], pins: [], builder: null, tables: [], tablesLoading: true, retired: [] });
const { snackbar, notify } = useSnackbar();
const picker = reactive({ open: false, bots: [], botId: null, loading: false, saving: false });
const pinned = computed(() => new Set(state.pins));
const liveTables = computed(() => state.tables.filter((table) => !table.obsolete));
// Views (D-55) sit with the apps, and can be picked out once there are any.
const showing = ref("all");
const hasViews = computed(() => state.apps.some((app) => app.kind === "view") || state.retired.length > 0);
const tiles = computed(() => state.apps.filter((app) => (showing.value === "all" ? true : (app.kind === "view") === (showing.value === "views"))));

const changed = (at) => {
  const minutes = Math.round((Date.now() - new Date(at).getTime()) / 60000);
  if (minutes < 1) return "changed just now";
  if (minutes < 60) return `changed ${minutes} min ago`;
  if (minutes < 1440) return `changed ${Math.round(minutes / 60)} h ago`;
  return `changed ${new Date(at).toLocaleDateString()}`;
};

async function load() {
  state.loading = true;
  try {
    Object.assign(state, await appsApi.list());
  } finally {
    state.loading = false;
  }
  appsApi.tables().then(({ tables }) => Object.assign(state, { tables, tablesLoading: false }), () => (state.tablesLoading = false));
  appsApi.retiredViews().then(({ views }) => (state.retired = views), () => {});
}

// Retired views (D-62) come back as they were; one whose name is now taken comes back renamed, and says so.
async function bringBack(view) {
  try {
    const back = await appsApi.bringBack(view.view);
    notify(back.renamed ? `${view.title} is back, as ${back.title}, because another app or view has its name.` : `${back.title} is back.`);
    window.dispatchEvent(new CustomEvent("mercbot:apps-changed"));
    if (state.retired.length === 1) showing.value = "all";
    await load();
  } catch (error) {
    notify(error?.message || "It couldn't be brought back.", "error");
  }
}
onMounted(load);

async function togglePin(app) {
  const next = pinned.value.has(app.id) ? state.pins.filter((id) => id !== app.id) : [...state.pins, app.id];
  try {
    state.pins = (await appsApi.setPins(next)).pins;
    window.dispatchEvent(new CustomEvent("mercbot:apps-changed"));
  } catch (error) {
    notify(error?.message || "Pinning didn't work.", "error");
  }
}

function openBuilder() {
  router.push({ path: paths.page("/"), query: { bot: state.builder.id } });
}

async function newApp() {
  if (state.builder) return openBuilder();
  // Choosing the Builder is for owners and admins (owner, 2026-10-31).
  if (!state.canManage) return notify("This home has no Builder yet. Ask one of its owners or admins to choose one.");
  picker.loading = true;
  try {
    const { bots } = await botsApi.list();
    picker.bots = bots.filter((bot) => bot.kind !== "group");
    picker.botId = picker.bots[0]?.id ?? null;
  } finally {
    picker.loading = false;
  }
  picker.open = true;
}

async function chooseBuilder() {
  picker.saving = true;
  try {
    state.builder = (await appsApi.setBuilder(picker.botId)).builder;
    picker.open = false;
    openBuilder();
  } catch (error) {
    notify(error?.message || "That didn't work.", "error");
  } finally {
    picker.saving = false;
  }
}
</script>

<template>
  <div class="apps-home">
    <header class="apps-home__bar">
      <ShellUpButton />
      <v-tabs v-model="tab" color="primary" density="compact">
        <v-tab value="apps">Apps</v-tab>
        <v-tab value="data">Data</v-tab>
        <v-tab value="activity">Activity</v-tab>
        <v-tab value="templates">Templates</v-tab>
        <v-tab value="scripts">Scripts</v-tab>
        <v-tab value="look">Look</v-tab>
      </v-tabs>
      <v-spacer />
      <v-btn color="primary" variant="flat" prepend-icon="$add" @click="newApp">New app</v-btn>
    </header>

    <main class="apps-home__main">
      <template v-if="tab === 'apps'">
        <div v-if="state.loading" class="apps-home__grid">
          <v-skeleton-loader v-for="index in 4" :key="index" type="card" height="140" />
        </div>
        <v-card v-else-if="!state.apps.length" flat class="pa-6">
          <div class="text-body-1 mb-2">No apps yet.</div>
          <div class="text-body-2 text-medium-emphasis mb-4">Describe the app you want to {{ state.builder ? state.builder.name : "your Builder" }}, and it will make it for you.</div>
          <v-btn color="primary" variant="flat" prepend-icon="$add" @click="newApp">New app</v-btn>
        </v-card>
        <v-chip-group v-if="(state.apps.length && hasViews) || state.retired.length" v-model="showing" mandatory class="mb-2" aria-label="Show">
          <v-chip value="all" size="small" filter>All</v-chip>
          <v-chip value="apps" size="small" filter>Apps</v-chip>
          <v-chip value="views" size="small" filter>Views</v-chip>
          <v-chip v-if="state.retired.length" value="retired" size="small" filter>Retired</v-chip>
        </v-chip-group>
        <div v-if="showing === 'retired'" class="apps-home__grid">
          <v-card v-for="view in state.retired" :key="view.view" flat class="pa-4 apps-home__tile">
            <v-avatar :color="view.color" size="44" rounded="lg"><v-icon :icon="ICON_PATHS[view.icon] || ICON_PATHS.apps" color="white" /></v-avatar>
            <div class="text-subtitle-1 font-weight-medium mt-3">{{ view.title }}</div>
            <div class="d-flex align-center flex-wrap ga-2 mt-1">
              <v-chip size="x-small" variant="tonal">Retired</v-chip>
              <v-spacer />
              <v-btn variant="tonal" size="small" @click="bringBack(view)">Bring back</v-btn>
            </div>
          </v-card>
        </div>
        <div v-else-if="!state.loading && state.apps.length" class="apps-home__grid">
          <v-card v-for="app in tiles" :key="app.id" flat class="pa-4 apps-home__tile" :to="paths.page(`/apps/${app.slug}`)">
            <div class="d-flex align-start ga-3">
              <v-avatar :color="app.color" size="44" rounded="lg"><v-icon :icon="ICON_PATHS[app.icon] || ICON_PATHS.apps" color="white" /></v-avatar>
              <v-spacer />
              <v-menu>
                <template #activator="{ props: menuProps }">
                  <v-btn v-bind="menuProps" icon="$moreVert" variant="text" size="small" :aria-label="app.kind === 'view' ? 'View menu' : 'App menu'" @click.prevent />
                </template>
                <v-list density="compact">
                  <v-list-item :prepend-icon="pinned.has(app.id) ? '$keepOffFilled' : '$keepFilled'" :title="pinned.has(app.id) ? 'Unpin from sidebar' : 'Pin to sidebar'" @click="togglePin(app)" />
                  <v-list-item v-if="app.draftVersionId" title="Preview the draft" :to="paths.page(`/apps/${app.slug}?version=draft`)" />
                </v-list>
              </v-menu>
            </div>
            <div class="text-subtitle-1 font-weight-medium mt-3">{{ app.name }}</div>
            <div class="d-flex align-center flex-wrap ga-2 mt-1">
              <v-chip size="x-small" variant="tonal">{{ app.kind === "view" ? "View" : app.visibility === "public" ? "Public" : "Internal" }}</v-chip>
              <v-chip v-if="app.draftVersionId" size="x-small" variant="tonal" color="primary">Draft</v-chip>
              <v-chip v-if="!app.liveVersionId && app.kind !== 'view'" size="x-small" variant="tonal" color="warning">Not published</v-chip>
              <span class="text-caption text-medium-emphasis">{{ changed(app.updatedAt) }}</span>
            </div>
          </v-card>
        </div>
      </template>

      <template v-else-if="tab === 'data'">
        <v-card flat>
          <v-table>
            <thead>
              <tr><th>Table</th><th>Records</th><th>Fields</th><th>Used by</th></tr>
            </thead>
            <tbody v-if="state.tablesLoading">
              <tr v-for="index in 3" :key="index"><td v-for="column in 4" :key="column"><v-skeleton-loader type="text" /></td></tr>
            </tbody>
            <tbody v-else>
              <tr v-for="table in liveTables" :key="table.id" class="apps-home__row" @click="router.push(paths.page(`/apps/data/${table.key}`))">
                <td class="font-weight-medium">{{ table.label }}</td>
                <td>{{ table.count ?? "—" }}</td>
                <td>{{ table.fields.filter((field) => !field.obsolete).length }}</td>
                <td>{{ table.usedBy.map((app) => app.name).join(", ") || "—" }}</td>
              </tr>
              <tr v-if="!liveTables.length"><td colspan="4" class="text-medium-emphasis">No tables yet. The Builder makes them when it makes an app.</td></tr>
            </tbody>
          </v-table>
        </v-card>
      </template>

      <AppsTemplates v-else-if="tab === 'templates'" @notify="notify" />
      <AppsScripts v-else-if="tab === 'scripts'" @notify="notify" />
      <AppsLook v-else-if="tab === 'look'" @notify="notify" />
      <AppsActivity v-else />
    </main>

    <v-dialog v-model="picker.open" max-width="440">
      <v-card rounded="lg" class="pa-4">
        <div class="text-h6 mb-2">Choose a Builder</div>
        <div class="text-body-2 text-medium-emphasis mb-4">One of your bots builds the apps of this home. You can move the role to another bot later.</div>
        <SelectField v-model="picker.botId" :items="picker.bots" :loading="picker.loading" item-title="name" item-value="id" label="Bot" variant="outlined" density="comfortable" />
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="picker.open = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :disabled="!picker.botId || picker.saving" @click="chooseBuilder">{{ picker.saving ? "Saving…" : "Make Builder" }}</v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar.open" :color="snackbar.color" timeout="3000">{{ snackbar.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.apps-home {
  min-height: 100vh;
}
.apps-home__bar {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.apps-home__main {
  padding: 24px;
  max-width: 1200px;
}
.apps-home__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 16px;
}
.apps-home__row {
  cursor: pointer;
}
</style>
