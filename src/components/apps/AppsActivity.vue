<script setup>
import { computed, onMounted, ref, watch } from "vue";
import SelectField from "@jskit-ai/http-web/client/components/SelectField";
import { appsApi } from "./appsApi.js";
import { actorName, showValue, whenText as when } from "./appRuntime.js";

// The audit trail (D-35): who changed what, where, and each field's old → new value. The same
// list serves the whole home, one app (`app`) or one table (`table`).
const props = defineProps({
  app: { type: String, default: "" },
  table: { type: String, default: "" },
  compact: { type: Boolean, default: false }
});

const events = ref([]);
const tables = ref([]);
const apps = ref([]);
const listsLoading = ref(true);
const loading = ref(true);
const more = ref(false);
const filterTable = ref(props.table || null);
const filterApp = ref(props.app || null);
const filterActor = ref(null);
const filterFrom = ref("");
const filterTo = ref("");
const actors = ref([]);

const tableById = computed(() => new Map(tables.value.map((table) => [table.id, table])));
const appById = computed(() => new Map(apps.value.map((app) => [app.id, app])));

async function load(before = null) {
  loading.value = true;
  try {
    const { events: page, actors: people } = await appsApi.activity({ table: filterTable.value, app: filterApp.value, actor: filterActor.value, from: filterFrom.value, to: filterTo.value, before });
    if (people) actors.value = people.map((person) => ({ ...person, title: actorName(person) }));
    events.value = before ? [...events.value, ...page] : page;
    more.value = page.length === 50;
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  const [tableList, appList] = await Promise.all([appsApi.tables({ brief: true }).catch(() => ({ tables: [] })), appsApi.list().catch(() => ({ apps: [] }))]);
  tables.value = tableList.tables;
  apps.value = appList.apps;
  listsLoading.value = false;
  await load();
});
watch([filterTable, filterApp, filterActor, filterFrom, filterTo], () => load());

const who = (event) => actorName(event.actor);

function where(event) {
  const via = event.via || {};
  const app = appById.value.get(via.appId);
  if (via.kind === "screen") return `${app?.name || "An app"} › ${via.screen}`;
  if (via.kind === "data") return "Data tab";
  if (via.kind === "import") return `Import of ${via.file || "a file"}`;
  if (via.kind === "chat") return "Chat";
  if (via.kind === "watch") return "A watch";
  if (via.kind === "task") return "A task from a button";
  if (via.kind === "public") return `${app?.name || "An app"} › public form`;
  if (via.kind === "app") return app?.name || "Apps";
  if (via.kind === "schema") return "Tables";
  if (via.kind === "settings") return "Settings";
  return "";
}

const recordLabel = (event) => {
  const table = tableById.value.get(event.tableId);
  return table ? `${table.label} #${event.recordId}` : `#${event.recordId}`;
};

// Field changes, named by their current labels; removed fields say so.
function changes(event) {
  const table = tableById.value.get(event.tableId);
  return Object.entries(event.changes || {}).map(([fieldId, pair]) => {
    const field = table?.fields.find((entry) => entry.id === fieldId);
    const [before, after] = Array.isArray(pair) ? pair : [undefined, pair];
    const label = field ? `${field.label}${field.obsolete ? " (removed)" : ""}` : "A field";
    const show = (value) => (field?.type === "link" ? (value ? `#${value}` : "—") : showValue(field, value));
    return { label, before: show(before), after: show(after) };
  });
}

function summary(event) {
  const c = event.changes || {};
  if (event.action === "create") return `added ${recordLabel(event)}`;
  if (event.action === "update") return `changed ${recordLabel(event)}`;
  if (event.action === "obsolete") return `marked ${recordLabel(event)} obsolete`;
  if (event.action === "restore") return `restored ${recordLabel(event)}`;
  if (c.createdTable) return `created the table ${c.createdTable.label || c.createdTable.key}`;
  if (c.addedField) return `added the field ${c.addedField.key} to ${tableById.value.get(event.tableId)?.label || "a table"}`;
  if (c.changedFormula) return `changed how ${c.changedFormula.key} is calculated`;
  if (c.renamedField) return `renamed ${c.renamedField.from?.label} to ${c.renamedField.to?.label || c.renamedField.to?.key}`;
  if (c.removedField) return `removed the field ${c.removedField.label || ""}`;
  if (c.createdApp) return `created the app ${c.createdApp.name}`;
  if (c.publishedVersion) return `published version ${c.publishedVersion.number}${c.publishedVersion.summary ? `: ${c.publishedVersion.summary}` : ""}`;
  if (c.builder) return `made ${c.builder.name} the Builder`;
  if (c.publicApp) return c.publicApp.on ? `made ${c.publicApp.name} public` : `made ${c.publicApp.name} internal again`;
  if (c.unlinkedCopy) return `unlinked this copy of Mercbot (“${c.unlinkedCopy.name}”) from ${c.unlinkedCopy.hub}`;
  return event.action;
}
const showChanges = (event) => ["create", "update"].includes(event.action);
</script>

<template>
  <div class="d-flex flex-column ga-3">
    <div v-if="!compact" class="d-flex flex-wrap ga-3">
      <SelectField v-model="filterTable" :items="tables.filter((table) => !table.obsolete)" :loading="listsLoading" item-title="label" item-value="id" label="Table" clearable density="compact" variant="outlined" hide-details class="activity-filter" />
      <SelectField v-model="filterApp" :items="apps" :loading="listsLoading" item-title="name" item-value="id" label="App" clearable density="compact" variant="outlined" hide-details class="activity-filter" />
      <SelectField v-model="filterActor" :items="actors" :loading="loading" item-title="title" item-value="id" label="Who" clearable density="compact" variant="outlined" hide-details class="activity-filter" />
      <v-text-field v-model="filterFrom" type="date" label="From" density="compact" variant="outlined" hide-details class="activity-date" />
      <v-text-field v-model="filterTo" type="date" label="To" density="compact" variant="outlined" hide-details class="activity-date" />
    </div>
    <template v-if="loading && !events.length">
      <v-skeleton-loader v-for="index in 4" :key="index" type="list-item-two-line" />
    </template>
    <div v-else-if="!events.length" class="text-medium-emphasis text-body-2">No changes yet.</div>
    <v-card v-for="event in events" :key="event.id" flat class="pa-3">
      <div class="text-body-2">
        <strong>{{ who(event) }}</strong> {{ summary(event) }}
      </div>
      <div class="text-caption text-medium-emphasis">{{ where(event) }}<template v-if="where(event)"> · </template>{{ when(event.at) }}</div>
      <div v-if="showChanges(event)" class="mt-1">
        <div v-for="change in changes(event)" :key="change.label" class="text-body-2">
          {{ change.label }}: <span v-if="event.action === 'update'" class="text-medium-emphasis">{{ change.before }} → </span>{{ change.after }}
        </div>
      </div>
    </v-card>
    <v-btn v-if="more" variant="text" :disabled="loading" @click="load(events.at(-1).id)">{{ loading ? "Loading…" : "Show older" }}</v-btn>
  </div>
</template>

<style scoped>
.activity-filter {
  max-width: 220px;
}
.activity-date {
  max-width: 170px;
}
</style>
