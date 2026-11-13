<script setup>
import { onMounted, ref } from "vue";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { appsApi, errorText } from "./appsApi.js";
import { whenText } from "./appRuntime.js";

// The Apps home's Scripts tab (D-35): every script in the home, with its app and last run, and the
// web addresses scripts may call. Owners and admins edit the addresses and their secret headers
// (API keys); a stored secret is never shown again, only its name.
const paths = usePaths();
const emit = defineEmits(["notify"]);
const KIND = { action: "Button", source: "Screen data", rule: "Rule on saving", function: "Formula function", job: "Job" };

const scripts = ref(null);
const entries = ref([]);
const canManage = ref(false);
const saving = ref(false);

// Each address: its origin and headers. A stored header is `kept`: left empty, its secret stays.
const toEntry = (item) => ({ origin: item.origin, headers: item.secretHeaders.map((name) => ({ name, value: "", kept: true })) });

async function load() {
  try {
    const result = await appsApi.homeScripts();
    scripts.value = result.scripts;
    entries.value = result.webAccess.map(toEntry);
    canManage.value = result.canManage;
  } catch (error) {
    emit("notify", errorText(error, "The scripts couldn't load."), "error");
  }
}

async function save() {
  saving.value = true;
  try {
    const body = entries.value.filter((entry) => entry.origin.trim()).map((entry) => ({ origin: entry.origin.trim(), headers: Object.fromEntries(entry.headers.filter((header) => header.name.trim()).map((header) => [header.name.trim(), header.kept && !header.value ? null : header.value])) }));
    entries.value = (await appsApi.setWebAccess(body)).webAccess.map(toEntry);
    emit("notify", "Saved. Scripts can call these addresses.");
  } catch (error) {
    emit("notify", errorText(error, "That couldn't be saved."), "error");
  } finally {
    saving.value = false;
  }
}
onMounted(load);
</script>

<template>
  <div class="apps-scripts">
    <v-skeleton-loader v-if="!scripts" type="table" />
    <template v-else>
      <v-card v-if="scripts.length" flat class="mb-6">
        <v-table>
          <thead>
            <tr><th>Script</th><th>App</th><th>Kind</th><th>Last run</th></tr>
          </thead>
          <tbody>
            <tr v-for="script in scripts" :key="script.id">
              <td><div class="text-body-2">{{ script.summary }}</div><div class="text-caption text-medium-emphasis">{{ script.key }}</div></td>
              <td><router-link :to="paths.page(`/apps/${script.app.slug}`)">{{ script.app.name }}</router-link></td>
              <td>{{ KIND[script.kind] }}</td>
              <td>
                <span v-if="script.kind === 'function'" class="text-medium-emphasis">Runs in formulas</span>
                <span v-else-if="!script.lastRun" class="text-medium-emphasis">Not yet</span>
                <span v-else :class="script.lastRun.ok ? '' : 'text-error'">{{ script.lastRun.ok ? "OK" : "Failed" }} · {{ whenText(script.lastRun.at) }}</span>
              </td>
            </tr>
          </tbody>
        </v-table>
      </v-card>
      <div v-else class="text-body-2 text-medium-emphasis mb-6">No scripts yet. Ask the Builder for logic that formulas can't express: it writes scripts with tests, and you'll find them here and in each app's Logic tab.</div>

      <div class="text-subtitle-1 mb-1">Web addresses scripts may call</div>
      <div class="text-body-2 text-medium-emphasis mb-3">Only https addresses on this list, never private networks. A secret header, such as an API key, is added by Mercbot when a script calls; scripts never see it, and it isn't shown again here.</div>
      <v-card v-for="(entry, index) in entries" :key="index" flat class="pa-3 mb-3">
        <div class="d-flex ga-2 align-center">
          <v-text-field v-model="entry.origin" label="Address (e.g. https://api.example.com)" variant="outlined" density="compact" hide-details :disabled="!canManage" />
          <v-btn v-if="canManage" variant="text" size="small" @click="entries.splice(index, 1)">Remove</v-btn>
        </div>
        <div v-for="(header, headerIndex) in entry.headers" :key="headerIndex" class="d-flex ga-2 align-center mt-2">
          <v-text-field v-model="header.name" label="Header" variant="outlined" density="compact" hide-details :disabled="!canManage || header.kept" />
          <v-text-field v-model="header.value" :label="header.kept ? 'Secret kept (type to replace)' : 'Secret value'" type="password" variant="outlined" density="compact" hide-details autocomplete="new-password" :disabled="!canManage" />
          <v-btn v-if="canManage" variant="text" size="small" @click="entry.headers.splice(headerIndex, 1)">Remove</v-btn>
        </div>
        <v-btn v-if="canManage" variant="text" size="small" class="mt-2" @click="entry.headers.push({ name: '', value: '', kept: false })">Add a secret header</v-btn>
      </v-card>
      <div v-if="!entries.length" class="text-body-2 text-medium-emphasis mb-3">None yet: scripts can't call outside services.</div>
      <div v-if="canManage" class="d-flex ga-2">
        <v-btn variant="text" @click="entries.push({ origin: '', headers: [] })">Add an address</v-btn>
        <v-btn color="primary" variant="flat" :disabled="saving" @click="save">{{ saving ? "Saving…" : "Save" }}</v-btn>
      </div>
      <div v-else class="text-body-2 text-medium-emphasis">Only the home's owners and admins can change this list.</div>
    </template>
  </div>
</template>

<style scoped>
.apps-scripts {
  max-width: 960px;
}
</style>
