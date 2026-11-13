<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import ShellUpButton from "@jskit-ai/shell-web/client/components/ShellUpButton";
import FieldRemoval from "./FieldRemoval.vue";
import RecordDialog from "./RecordDialog.vue";
import { appsApi, errorText } from "./appsApi.js";
import { isCalculated } from "@local/apps/shared";
import { actorName, showValue, whenText as when } from "./appRuntime.js";
import { exportTable, importRows, matchColumns, readSheetFile } from "./sheets.js";
import { useSnackbar } from "./useSnackbar.js";

// One table as a spreadsheet (D-35): search, sort, pages, add and edit records, mark obsolete
// (never delete) and restore, each record's history, and CSV/Excel import and export. Every write
// goes through the data gate.
const route = useRoute();
const key = computed(() => String(route.params.table || ""));

const table = ref(null);
const tables = ref([]);
const records = ref([]);
const total = ref(0);
const loading = ref(true);
const problem = ref("");
const options = reactive({ page: 1, itemsPerPage: 25, sortBy: [] });
const search = ref("");
const showObsolete = ref(false);
const editor = reactive({ open: false, record: null });
const history = reactive({ open: false, record: null, events: [], loading: false });
const { snackbar, notify } = useSnackbar();
const fieldsDialog = reactive({ open: false, removing: null });
const importing = reactive({ open: false, file: null, rows: [], match: null, problem: "", errors: [], busy: false });
const exporting = ref(false);

const fields = computed(() => (table.value?.fields || []).filter((field) => !field.obsolete));
// Calculated fields (D-78) are worked out on every read, not stored: the database can't search, sort, filter or
// group by them, which the table and its Fields say in a line, rather than leaving a column that doesn't sort.
const calculated = computed(() => fields.value.filter(isCalculated));
const calculatedNames = computed(() => calculated.value.map((field) => field.label).join(", "));
const headers = computed(() => [
  // A calculated field (D-78) isn't stored, so the database can't sort by it.
  ...fields.value.map((field) => ({ title: field.label, key: field.id, sortable: !isCalculated(field) })),
  { title: "", key: "actions", sortable: false, align: "end", width: 1 }
]);
const fail = (error) => notify(errorText(error, "That didn't work."), "error");

async function load() {
  loading.value = true;
  problem.value = "";
  try {
    const sort = options.sortBy[0];
    const result = await appsApi.records(key.value, {
      page: options.page,
      size: options.itemsPerPage,
      search: search.value,
      sort: sort?.key,
      desc: sort?.order === "desc" ? "true" : undefined,
      obsolete: showObsolete.value ? "true" : undefined
    });
    table.value = result.table;
    records.value = result.records;
    total.value = result.total ?? result.records.length;
  } catch (error) {
    problem.value = error?.status === 404 ? "This table doesn't exist in this home." : "The table couldn't load.";
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  tables.value = (await appsApi.tables({ brief: true }).catch(() => ({ tables: [] }))).tables;
});
let timer = null;
watch(search, () => {
  clearTimeout(timer);
  timer = setTimeout(() => {
    options.page = 1;
    load();
  }, 300);
});
watch(showObsolete, load);
watch(key, load);

function onOptions(next) {
  Object.assign(options, { page: next.page, itemsPerPage: next.itemsPerPage, sortBy: next.sortBy });
  load();
}

const edit = (record = null) => Object.assign(editor, { open: true, record });

async function setObsolete(record, obsolete) {
  try {
    await (obsolete ? appsApi.obsoleteRecord(key.value, record.id) : appsApi.restoreRecord(key.value, record.id));
    notify(obsolete ? "Marked obsolete. It's hidden, not deleted." : "Restored.");
    await load();
  } catch (error) {
    fail(error);
  }
}

async function openHistory(record) {
  Object.assign(history, { open: true, record, events: [], loading: true });
  try {
    history.events = (await appsApi.recordHistory(key.value, record.id)).events;
  } catch (error) {
    fail(error);
  } finally {
    history.loading = false;
  }
}

async function download(format) {
  exporting.value = true;
  try {
    const count = await exportTable(key.value, format);
    notify(`Exported ${count} record${count === 1 ? "" : "s"}.`);
  } catch (error) {
    fail(error);
  } finally {
    exporting.value = false;
  }
}

const openImport = () => Object.assign(importing, { open: true, file: null, rows: [], match: null, problem: "", errors: [], busy: false });

async function readFile(value) {
  const file = Array.isArray(value) ? value[0] : value;
  Object.assign(importing, { file: file || null, rows: [], match: null, problem: "", errors: [] });
  if (!file) return;
  try {
    const [header = [], ...rows] = await readSheetFile(file);
    importing.rows = rows;
    importing.match = matchColumns(table.value, header);
    if (!importing.match.columns.some(Boolean)) importing.problem = "No column's heading matches a field of this table. The first row should name the fields.";
  } catch (error) {
    importing.problem = error?.message || "That file couldn't be read.";
  }
}

async function runImport() {
  importing.busy = true;
  importing.errors = [];
  try {
    const { imported, errors } = await importRows(key.value, importing.file, importing.rows, importing.match.columns);
    if (errors.length) {
      importing.errors = errors;
      if (imported) importing.problem = `${imported} records were added before row ${errors[0].row} failed.`;
      return;
    }
    importing.open = false;
    notify(`Imported ${imported} record${imported === 1 ? "" : "s"}.`);
    await load();
  } catch (error) {
    importing.problem = errorText(error, "The import didn't work.");
  } finally {
    importing.busy = false;
  }
}
const usedColumns = computed(() => [...new Set((importing.match?.columns || []).filter(Boolean).map((field) => field.label))]);

const fieldById = (id) => table.value?.fields.find((field) => field.id === id);
const what = { create: "added it", update: "changed it", obsolete: "marked it obsolete", restore: "restored it" };
const titleOf = (record) => (record ? String(record[table.value?.titleFieldId] ?? `#${record.id}`) : "");
</script>

<template>
  <div class="apps-table">
    <header class="apps-table__bar">
      <ShellUpButton />
      <span class="text-subtitle-1 font-weight-medium">{{ table?.label }}</span>
      <v-spacer />
      <v-btn variant="text" :disabled="!table" @click="Object.assign(fieldsDialog, { open: true, removing: null })">Fields</v-btn>
      <v-btn variant="text" :disabled="!table" prepend-icon="$uploadArrow" @click="openImport">Import</v-btn>
      <v-menu>
        <template #activator="{ props: menuProps }">
          <v-btn v-bind="menuProps" variant="text" :disabled="!table || exporting" prepend-icon="$download">{{ exporting ? "Exporting…" : "Export" }}</v-btn>
        </template>
        <v-list density="compact">
          <v-list-item title="CSV (.csv)" @click="download('csv')" />
          <v-list-item title="Excel (.xlsx)" @click="download('xlsx')" />
        </v-list>
      </v-menu>
      <v-btn color="primary" variant="flat" prepend-icon="$add" :disabled="!table" @click="edit()">New record</v-btn>
    </header>

    <main class="apps-table__main">
      <v-alert v-if="problem" type="error" variant="tonal" class="mb-4">{{ problem }}</v-alert>
      <div class="d-flex align-center flex-wrap ga-4 mb-4">
        <v-text-field v-model="search" label="Search" density="comfortable" variant="outlined" hide-details clearable class="apps-table__search" />
        <v-switch v-model="showObsolete" label="Show obsolete" color="primary" inset hide-details />
      </div>
      <p v-if="calculated.length" class="text-body-2 text-medium-emphasis mb-3" data-testid="apps-table-calculated-note">
        Search and sorting leave out {{ calculatedNames }}: {{ calculated.length === 1 ? "it's" : "they're" }} calculated each time a record is shown, not stored.
      </p>
      <v-card flat>
        <v-data-table-server
          :headers="headers"
          :items="records"
          :items-length="total"
          :loading="loading"
          :page="options.page"
          :items-per-page="options.itemsPerPage"
          :sort-by="options.sortBy"
          item-value="id"
          hover
          @update:options="onOptions"
          @click:row="(_event, { item }) => !item.obsolete && edit(item)"
        >
          <template #loading><v-skeleton-loader type="table-row@5" /></template>
          <template v-for="field in fields" :key="field.id" #[`item.${field.id}`]="{ item }">
            <span :class="{ 'text-disabled': item.obsolete }">{{ showValue(field, item[field.id]) }}</span>
          </template>
          <template #[`item.actions`]="{ item }">
            <div class="d-flex align-center justify-end ga-1">
              <v-chip v-if="item.obsolete" size="x-small" variant="tonal">Obsolete</v-chip>
              <v-menu>
                <template #activator="{ props: menuProps }">
                  <v-btn v-bind="menuProps" icon="$moreVert" variant="text" size="small" aria-label="Record menu" @click.stop />
                </template>
                <v-list density="compact">
                  <v-list-item v-if="!item.obsolete" title="Edit" @click="edit(item)" />
                  <v-list-item title="History" @click="openHistory(item)" />
                  <v-list-item v-if="!item.obsolete" title="Mark obsolete" @click="setObsolete(item, true)" />
                  <v-list-item v-else title="Restore" @click="setObsolete(item, false)" />
                </v-list>
              </v-menu>
            </div>
          </template>
          <template #no-data><span class="text-medium-emphasis">{{ search ? "Nothing matches." : "No records yet." }}</span></template>
        </v-data-table-server>
      </v-card>
    </main>

    <RecordDialog v-model:open="editor.open" :table="table" :tables="tables" :record="editor.record" @saved="() => { notify('Saved.'); load(); }" />

    <v-dialog v-model="fieldsDialog.open" max-width="560">
      <v-card rounded="lg" class="pa-4">
        <FieldRemoval v-if="fieldsDialog.removing" :key="fieldsDialog.removing" :field-id="fieldsDialog.removing" @cancel="fieldsDialog.removing = null" @done="() => { notify('Field removed.'); load(); }" />
        <template v-else>
          <div class="text-subtitle-1 mb-2">Fields of {{ table?.label }}</div>
          <div class="text-body-2 text-medium-emphasis mb-3">Ask the Builder to add or rename fields. Removing one keeps its data.</div>
          <v-list density="compact" class="pa-0">
            <v-list-item v-for="field in fields" :key="field.id" :title="field.label" :subtitle="`${field.key} · ${field.type}${isCalculated(field) ? ` · calculated: ${field.options.formula}` : ''}`">
              <template #append><v-btn size="small" variant="text" color="error" @click="fieldsDialog.removing = field.id">Remove…</v-btn></template>
            </v-list-item>
          </v-list>
          <div v-if="calculated.length" class="text-body-2 text-medium-emphasis mt-2" data-testid="apps-fields-calculated-note">
            Calculated fields aren't stored, so lists can't be filtered, sorted or grouped by them. If you need that, ask the Builder for a stored field instead.
          </div>
          <div class="d-flex justify-end"><v-btn variant="text" @click="fieldsDialog.open = false">Close</v-btn></div>
        </template>
      </v-card>
    </v-dialog>

    <v-dialog v-model="importing.open" max-width="560" :persistent="importing.busy">
      <v-card rounded="lg" class="pa-4">
        <div class="text-subtitle-1 mb-2">Import into {{ table?.label }}</div>
        <div class="text-body-2 text-medium-emphasis mb-4">
          A .csv or .xlsx file whose first row names the fields. Each row becomes a new record. If any row has a problem, nothing is added.
        </div>
        <v-file-input :model-value="importing.file" accept=".csv,.xlsx" label="File" density="comfortable" variant="outlined" prepend-icon="" prepend-inner-icon="$uploadArrow" hide-details :disabled="importing.busy" @update:model-value="readFile" />
        <template v-if="importing.match && !importing.problem">
          <div class="text-body-2 mt-4">{{ importing.rows.length }} row{{ importing.rows.length === 1 ? "" : "s" }}. Filling: {{ usedColumns.join(", ") }}.</div>
          <div v-if="importing.match.ignored.length" class="text-body-2 text-medium-emphasis mt-1">Not used (no field with that name): {{ importing.match.ignored.join(", ") }}.</div>
          <div v-if="importing.match.calculated.length" class="text-body-2 text-medium-emphasis mt-1">Not used (calculated, worked out again): {{ importing.match.calculated.join(", ") }}.</div>
          <v-alert v-if="importing.match.missing.length" type="warning" variant="tonal" density="compact" class="mt-3">
            Required, but no column: {{ importing.match.missing.map((field) => field.label).join(", ") }}.
          </v-alert>
        </template>
        <v-alert v-if="importing.problem" type="error" variant="tonal" density="compact" class="mt-3">{{ importing.problem }}</v-alert>
        <v-alert v-if="importing.errors.length" type="error" variant="tonal" density="compact" class="mt-3">
          <div class="mb-1">{{ importing.problem ? "" : "Nothing was imported. " }}Fix these rows and try again:</div>
          <div v-for="error in importing.errors" :key="`${error.row}-${error.message}`" class="text-body-2">Row {{ error.row }}: {{ error.message }}</div>
        </v-alert>
        <div class="d-flex justify-end ga-2 mt-4">
          <v-btn variant="text" :disabled="importing.busy" @click="importing.open = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :disabled="importing.busy || !importing.rows.length || !usedColumns.length || Boolean(importing.problem)" @click="runImport">
            {{ importing.busy ? "Importing…" : `Import ${importing.rows.length || ""} record${importing.rows.length === 1 ? "" : "s"}` }}
          </v-btn>
        </div>
      </v-card>
    </v-dialog>

    <v-navigation-drawer v-model="history.open" location="right" temporary width="420">
      <div class="pa-4">
        <div class="text-subtitle-1 mb-3">History of {{ titleOf(history.record) }}</div>
        <v-skeleton-loader v-if="history.loading" type="list-item-two-line@3" />
        <div v-else-if="!history.events.length" class="text-medium-emphasis text-body-2">No changes recorded.</div>
        <v-card v-for="event in history.events" :key="event.id" flat class="pa-3 mb-2">
          <div class="text-body-2"><strong>{{ actorName(event.actor) }}</strong> {{ what[event.action] || event.action }}</div>
          <div class="text-caption text-medium-emphasis">{{ when(event.at) }}</div>
          <div v-for="(pair, fieldId) in event.changes" :key="fieldId" class="text-body-2">
            {{ fieldById(fieldId)?.label || "A removed field" }}:
            <span v-if="event.action === 'update'" class="text-medium-emphasis">{{ showValue(fieldById(fieldId), pair[0]) }} → </span>{{ showValue(fieldById(fieldId), pair[1]) }}
          </div>
        </v-card>
      </div>
    </v-navigation-drawer>

    <v-snackbar v-model="snackbar.open" :color="snackbar.color" timeout="3000">{{ snackbar.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.apps-table__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 12px;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.apps-table__main {
  padding: 24px;
}
.apps-table__search {
  max-width: 320px;
}
</style>
