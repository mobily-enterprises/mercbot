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
const canManage = ref(false);
const loading = ref(true);
const installing = ref("");

onMounted(async () => {
  try {
    ({ templates: templates.value, canManage: canManage.value } = await appsApi.templates());
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
  </div>
</template>

<style scoped>
.apps-templates {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 16px;
}
</style>
