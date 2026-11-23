<script setup>
import { onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { appsApi, errorText } from "./appsApi.js";
import { ICON_PATHS } from "./appRuntime.js";

// Ready-made apps (D-35, stage 3). Installing one adds its tables (reusing any this home already
// has) and saves the app as a draft to preview and publish, like any change. Owners and admins
// install; anyone can ask the Builder to install and adapt one.
const emit = defineEmits(["notify"]);
const router = useRouter();
const paths = usePaths();
const templates = ref([]);
// The shared tables every home builds on (D-130): what each is for, what it links to, and whether this home has it.
const sharedTables = ref([]);
const canManage = ref(false);
const loading = ref(true);
const installing = ref("");

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
    <div class="apps-templates">
      <v-card v-for="template in templates" :key="template.key" flat class="pa-4 d-flex flex-column" :data-template="template.key">
        <div class="d-flex align-center ga-3 mb-2">
          <v-avatar :color="template.color" size="36" rounded="lg"><v-icon :icon="ICON_PATHS[template.icon] || ICON_PATHS.apps" color="white" size="20" /></v-avatar>
          <span class="text-subtitle-1">{{ template.name }}</span>
          <v-chip v-if="template.public" size="x-small" variant="tonal">Public</v-chip>
        </div>
        <div class="text-body-2 mb-2">{{ template.description }}</div>
        <div class="text-caption text-medium-emphasis mb-3">{{ template.screens }} screens · tables: {{ template.tables.join(", ") }}</div>
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
      <v-table density="comfortable">
        <tbody>
          <tr v-for="table in sharedTables" :key="table.key" :data-shared-table="table.key">
            <td class="text-body-2 font-weight-medium">
              <router-link v-if="table.inHome" :to="paths.page(`/apps/data/${table.key}`)">{{ table.label }}</router-link>
              <span v-else>{{ table.label }}</span>
            </td>
            <td class="text-body-2">
              {{ table.description }}
              <span v-if="table.extends" class="text-on-surface-variant"> One row per record of {{ table.extends }}.</span>
              <span v-else-if="table.linksTo.length" class="text-on-surface-variant"> Links to {{ table.linksTo.join(", ") }}.</span>
            </td>
            <td class="text-right">
              <v-chip v-if="table.inHome" size="small" variant="tonal" color="primary">In this home</v-chip>
              <span v-else class="text-caption text-on-surface-variant">Not added yet</span>
            </td>
          </tr>
        </tbody>
      </v-table>
    </section>
  </div>
</template>

<style scoped>
.apps-templates {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
</style>
