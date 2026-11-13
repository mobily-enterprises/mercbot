<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import AppLogic from "./AppLogic.vue";
import AppsActivity from "./AppsActivity.vue";
import { appsApi, errorText } from "./appsApi.js";
import { actorName, whenText as when } from "./appRuntime.js";
import { toYaml } from "./yaml.js";
import extensions from "../mercbot/extensions.js";

// Behind an app (D-35): what it is, its screens (read-only source), the tables it uses, its
// versions with Restore, and the changes made through it. Code and screens are never edited here:
// the Builder changes them. The Overview ends with the parts a copy built on Mercbot adds there (extensions.js).
const props = defineProps({
  loaded: { type: Object, required: true },
  home: { type: String, required: true }
});
// "failed" carries a message for the frame's snackbar; "themed" asks the frame to show the new look;
// "narrowed", that visitor access was narrowed into a new live version. An added part may emit "failed" and
// "narrowed", which are passed on.
const emit = defineEmits(["restored", "narrowed", "failed", "themed", "ask"]);

const tab = ref("overview");
const versions = ref([]);
// Whether older versions than those listed follow (the list comes a page at a time).
const moreVersions = ref(false);
// The tables this app uses, counted (null until they load).
const tables = ref(null);
const source = ref(null);
const confirm = ref(null);
const restoring = ref(false);
const problem = ref("");

const app = computed(() => props.loaded.app);
const definition = computed(() => props.loaded.definition);
const screens = computed(() => Object.entries(definition.value?.screens || {}));
// The app's named formulas (D-78), which every formula of it can call.
const formulas = computed(() => Object.entries(definition.value?.formulas || {}));
// Parts that still point at a removed field are skipped when the app runs.
const hidden = computed(() => (JSON.stringify(definition.value || {}).match(/\bf_[0-9a-z]{16}\b/gu) || []).length);

async function load() {
  problem.value = "";
  try {
    const [versionList, tableList] = await Promise.all([appsApi.versions(app.value.slug), appsApi.tables({ app: app.value.id })]);
    versions.value = versionList.versions;
    moreVersions.value = versionList.more;
    tables.value = tableList.tables;
  } catch (error) {
    problem.value = error?.message || "Details couldn't load.";
  }
}
async function olderVersions() {
  try {
    const older = await appsApi.versions(app.value.slug, versions.value.at(-1)?.id);
    versions.value = [...versions.value, ...older.versions];
    moreVersions.value = older.more;
  } catch (error) {
    problem.value = error?.message || "Details couldn't load.";
  }
}
watch(() => app.value?.id, load, { immediate: true });

const paths = usePaths();

// The added parts that are for this person, asked once.
const parts = ref([]);
onMounted(async () => {
  const answers = await Promise.all(extensions.appParts.map((part) => (part.visible ? part.visible().catch(() => false) : true)));
  parts.value = extensions.appParts.filter((_part, at) => answers[at]);
});

// This app's own colour and spacing; empty means the home's.
const look = reactive({ color: "", density: "" });
const savingLook = ref(false);
watch(() => app.value?.id, () => Object.assign(look, { color: app.value?.themeOverride?.color || "", density: app.value?.themeOverride?.density || "" }), { immediate: true });
async function saveLook() {
  savingLook.value = true;
  try {
    await appsApi.setAppTheme(app.value.slug, { color: look.color.trim() || undefined, density: look.density || undefined });
    emit("themed");
  } catch (error) {
    emit("failed", errorText(error, "The look couldn't be saved."));
  } finally {
    savingLook.value = false;
  }
}

const by = (version) => actorName(version.by, "");

async function restore() {
  restoring.value = true;
  try {
    const result = await appsApi.restore(app.value.slug, confirm.value.id);
    confirm.value = null;
    await load();
    emit("restored", result);
  } catch (error) {
    problem.value = error?.message || "Restoring didn't work.";
  } finally {
    restoring.value = false;
  }
}
</script>

<template>
  <div class="app-details">
    <v-tabs v-model="tab" density="compact" color="primary" show-arrows>
      <v-tab value="overview">Overview</v-tab>
      <v-tab value="screens">Screens</v-tab>
      <v-tab value="data">Data</v-tab>
      <v-tab value="logic">Logic</v-tab>
      <v-tab value="versions">Versions</v-tab>
      <v-tab value="activity">Activity</v-tab>
    </v-tabs>
    <v-alert v-if="problem" type="error" variant="tonal" density="compact" class="ma-3">{{ problem }}</v-alert>
    <v-alert v-if="hidden" type="warning" variant="tonal" density="compact" class="ma-3">
      {{ hidden }} part{{ hidden === 1 ? "" : "s" }} of this app {{ hidden === 1 ? "uses" : "use" }} a removed field and {{ hidden === 1 ? "is" : "are" }} hidden. Ask the Builder to tidy the app.
    </v-alert>

    <div class="pa-4">
      <template v-if="tab === 'overview'">
        <div class="text-body-2 text-medium-emphasis">Live version</div>
        <div class="text-body-1 mb-3">{{ loaded.version && !loaded.version.draft ? `Version ${loaded.version.number}${loaded.version.summary ? ` · ${loaded.version.summary}` : ""}` : "Not published yet" }}</div>
        <template v-if="app.draftVersionId">
          <div class="text-body-2 text-medium-emphasis">Draft</div>
          <div class="text-body-1 mb-3"><router-link :to="paths.page(`/apps/${app.slug}?version=draft`)">Preview the draft</router-link></div>
        </template>
        <div class="text-body-2 text-medium-emphasis">Screens</div>
        <div class="text-body-1 mb-4">{{ screens.length }}</div>

        <v-divider class="mb-3" />
        <div class="text-body-2 text-medium-emphasis">Look</div>
        <div class="text-body-2 mb-2">The home's look (Apps → Look), with this app's own colour and spacing if you set them.</div>
        <div class="d-flex flex-wrap ga-2 mb-2">
          <v-text-field v-model="look.color" label="Colour (e.g. #1E5BD8; empty: the home's)" variant="outlined" density="compact" hide-details class="flex-grow-1" :disabled="savingLook" />
          <v-select v-model="look.density" :items="[{ value: '', title: 'The home’s spacing' }, { value: 'comfortable', title: 'Comfortable' }, { value: 'compact', title: 'Compact' }]" label="Spacing" variant="outlined" density="compact" hide-details :disabled="savingLook" />
        </div>
        <div class="d-flex justify-end mb-4">
          <v-btn size="small" variant="flat" color="primary" :disabled="savingLook" @click="saveLook">{{ savingLook ? "Saving…" : "Save look" }}</v-btn>
        </div>
        <template v-for="(part, at) in parts" :key="at">
          <v-divider class="mb-3" />
          <component :is="part.component" :loaded="loaded" :home="home" @narrowed="(result) => emit('narrowed', result)" @failed="(message) => emit('failed', message)" />
        </template>
      </template>

      <template v-else-if="tab === 'screens'">
        <v-list density="compact" class="pa-0">
          <v-list-item v-for="[key, screen] in screens" :key="key" :title="key" :subtitle="`${(screen.content || []).length} parts · ${Object.keys(screen.data || {}).length} queries`">
            <template #append><v-btn size="small" variant="text" @click="source = { key, screen }">View source</v-btn></template>
          </v-list-item>
        </v-list>
      </template>

      <template v-else-if="tab === 'data'">
        <v-skeleton-loader v-if="!tables && !problem" type="list-item-two-line" />
        <div v-else-if="!tables?.length" class="text-medium-emphasis text-body-2">This app doesn't use any tables.</div>
        <v-list v-else density="compact" class="pa-0">
          <v-list-item v-for="table in tables" :key="table.id" :title="table.label" :subtitle="`${table.count ?? '—'} records`" :to="paths.page(`/apps/data/${table.key}`)" />
        </v-list>
      </template>

      <template v-else-if="tab === 'logic'">
        <div v-if="formulas.length" class="mb-4" data-testid="app-named-formulas">
          <div class="text-subtitle-2 mb-1">Formulas</div>
          <v-list density="compact" class="pa-0">
            <v-list-item v-for="[name, entry] in formulas" :key="name" :title="`${name}(${(entry.params || []).join(', ')})`" :subtitle="entry.formula" />
          </v-list>
        </div>
        <AppLogic :slug="app.slug" @ask="(about) => emit('ask', about)" />
      </template>

      <template v-else-if="tab === 'versions'">
        <v-list density="compact" class="pa-0">
          <v-list-item v-for="version in versions" :key="version.id" :title="version.draft ? 'Draft' : `Version ${version.number}${version.live ? ' · live' : ''}`" :subtitle="[version.summary, by(version), when(version.publishedAt || version.updatedAt)].filter(Boolean).join(' · ')">
            <template #append>
              <v-btn v-if="!version.draft && !version.live" size="small" variant="text" @click="confirm = version">Restore</v-btn>
            </template>
          </v-list-item>
        </v-list>
        <v-btn v-if="moreVersions" variant="text" size="small" class="mt-1" @click="olderVersions">Older versions</v-btn>
      </template>

      <AppsActivity v-else :app="app.id" compact />
    </div>

    <v-dialog :model-value="Boolean(source)" max-width="760" @update:model-value="source = null">
      <v-card v-if="source" rounded="lg" class="pa-4">
        <div class="text-subtitle-1 mb-2">{{ source.key }}</div>
        <pre class="app-details__source text-caption">{{ toYaml(source.screen) }}</pre>
        <div class="d-flex justify-end"><v-btn variant="text" @click="source = null">Close</v-btn></div>
      </v-card>
    </v-dialog>

    <v-dialog :model-value="Boolean(confirm)" max-width="440" @update:model-value="confirm = null">
      <v-card v-if="confirm" rounded="lg" class="pa-4">
        <div class="text-body-1 mb-4">Restore version {{ confirm.number }}? It becomes a new live version; nothing is lost.</div>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="confirm = null">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :disabled="restoring" @click="restore">{{ restoring ? "Restoring…" : "Restore" }}</v-btn>
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.app-details__source {
  white-space: pre-wrap;
  max-height: 60vh;
  overflow: auto;
}
</style>
