<script setup>
import { computed, ref, watch } from "vue";
import { VAULT_FIELDS } from "@local/account/shared/vault";
import { accountApi } from "./accountApi.js";
import { FIELD_TITLES, KIND_TITLES, ROW_LIMIT, guessKind, importItems, itemsFrom, matchColumns, previewValue, readCsvFile } from "./vaultImport.js";

// Settings → Vault → Import from a CSV file (vaultImport.js): choose a file, say what's in it,
// check which column fills each field and what will be saved, then import.
const open = defineModel({ type: Boolean, default: false });
const emit = defineEmits(["imported"]);

const file = ref(null);
const header = ref([]);
const rows = ref([]);
const kind = ref("login");
const columns = ref({});
const problem = ref("");
const busy = ref(false);
// The rows an import that stopped part way added: importing again sends only the others.
const saved = ref(new Set());

function reset() {
  file.value = null;
  header.value = [];
  rows.value = [];
  columns.value = {};
  problem.value = "";
  saved.value = new Set();
}
watch(open, (value) => {
  if (value) reset();
});

async function choose(value) {
  const chosen = Array.isArray(value) ? value[0] : value;
  reset();
  file.value = chosen || null;
  if (!chosen) return;
  try {
    const [names = [], ...rest] = await readCsvFile(chosen);
    if (!rest.length) throw new Error("That file has no rows under its first one, which should name the columns.");
    if (rest.length > ROW_LIMIT) throw new Error(`That file has more than ${ROW_LIMIT.toLocaleString()} rows. Split it into smaller files.`);
    header.value = names.map((name, index) => String(name ?? "").trim() || `Column ${index + 1}`);
    rows.value = rest;
    kind.value = guessKind(header.value);
    columns.value = matchColumns(kind.value, header.value);
  } catch (error) {
    problem.value = error?.message || "That file couldn't be read.";
  }
}

function chooseKind(value) {
  kind.value = value;
  columns.value = matchColumns(value, header.value);
}

const fields = computed(() => VAULT_FIELDS[kind.value]);
const result = computed(() => itemsFrom(kind.value, rows.value, columns.value, saved.value));
const shownFields = computed(() => fields.value.filter((field) => columns.value[field] >= 0));
const ready = computed(() => Boolean(result.value.items.length));
const plural = (count, word) => `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;

async function run() {
  busy.value = true;
  problem.value = "";
  const { items } = result.value;
  const { added, error } = await importItems(kind.value, items, accountApi.importVaultItems);
  busy.value = false;
  for (const item of items.slice(0, added)) saved.value.add(item.row);
  if (added) emit("imported", added);
  if (!error) {
    open.value = false;
    return;
  }
  const why = error?.message || "The import didn't work.";
  problem.value = added
    ? `Added ${plural(added, "item")} before the import stopped. ${why} Select Import to add the others.`
    : `Nothing was imported. ${why}`;
}
</script>

<template>
  <v-dialog v-model="open" max-width="640" scrim="scrim" :opacity="0.5" :persistent="busy">
    <v-card rounded="lg" class="mb-import pa-4" aria-label="Import from a CSV file">
      <div class="text-subtitle-1 mb-2">Import from a CSV file</div>
      <div class="text-body-2 text-medium-emphasis mb-4">
        A .csv file whose first row names the columns, such as one exported from a password manager, a browser or an address book.
        It's read here, in your browser: only what you import is sent, and passwords and card details are sealed like items you add by hand.
      </div>
      <v-file-input
        :model-value="file"
        accept=".csv,text/csv"
        label="CSV file"
        density="comfortable"
        variant="outlined"
        prepend-icon=""
        prepend-inner-icon="$uploadArrow"
        hide-details
        :disabled="busy"
        @update:model-value="choose"
      />

      <template v-if="rows.length">
        <div class="mb-import__kinds mt-4">
          <span class="text-body-2">The rows are</span>
          <v-btn-toggle :model-value="kind" mandatory density="compact" :disabled="busy" aria-label="What the rows are" @update:model-value="chooseKind">
            <v-btn v-for="(title, value) in KIND_TITLES" :key="value" :value="value" size="small">{{ title }}</v-btn>
          </v-btn-toggle>
        </div>

        <div class="text-body-2 mt-4 mb-2">Which column fills each detail:</div>
        <div class="mb-import__columns">
          <label v-for="field in fields" :key="field" class="mb-import__column">
            <span class="text-caption text-medium-emphasis">{{ FIELD_TITLES[field] }}</span>
            <select v-model="columns[field]" :disabled="busy">
              <option :value="-1">Not used</option>
              <option v-for="(name, index) in header" :key="index" :value="index">{{ name }}</option>
            </select>
          </label>
        </div>

        <div class="text-body-2 mt-4">
          {{ plural(result.items.length, "item") }} will be added<template v-if="result.skipped.length">; {{ plural(result.skipped.length, "row") }} can't be</template>.
        </div>
        <v-table v-if="result.items.length && shownFields.length" density="compact" class="mb-import__preview mt-2">
          <thead>
            <tr>
              <th>Row</th>
              <th v-for="field in shownFields" :key="field">{{ FIELD_TITLES[field] }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="item in result.items.slice(0, 5)" :key="item.row">
              <td>{{ item.row }}</td>
              <td v-for="field in shownFields" :key="field">{{ previewValue(field, item.data[field]) }}</td>
            </tr>
          </tbody>
        </v-table>
        <div v-if="result.items.length > 5" class="text-caption text-medium-emphasis mt-1">The first 5 of {{ plural(result.items.length, "item") }}. Hidden values are saved as they are in the file.</div>
        <v-alert v-if="result.skipped.length" type="warning" variant="tonal" density="compact" class="mt-3">
          <div v-for="entry in result.skipped.slice(0, 5)" :key="entry.row" class="text-body-2">Row {{ entry.row }}: {{ entry.problem }}</div>
          <div v-if="result.skipped.length > 5" class="text-body-2">And {{ plural(result.skipped.length - 5, "more row") }}.</div>
        </v-alert>
      </template>

      <v-alert v-if="problem" type="error" variant="tonal" density="compact" class="mt-3" role="alert">{{ problem }}</v-alert>
      <div class="d-flex justify-end ga-2 mt-4">
        <v-btn variant="text" :disabled="busy" @click="open = false">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="busy || !ready" @click="run">
          {{ busy ? "Importing…" : `Import ${ready ? plural(result.items.length, "item") : ""}`.trim() }}
        </v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>

<style scoped>
/* A dialog's card is a column that scrolls: without this, the preview table and the alerts, which
   clip what overflows them, shrink to fit and hide their rows and the end of their words. */
.mb-import > * {
  flex-shrink: 0;
}

.mb-import__kinds {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.mb-import__columns {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
}

.mb-import__column {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mb-import__column select {
  height: 34px;
  padding: 0 8px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font-size: 14px;
}

.mb-import__preview {
  overflow-x: auto;
}

.mb-import__preview td {
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
