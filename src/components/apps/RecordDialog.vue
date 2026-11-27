<script setup>
import { computed, reactive, ref, watch } from "vue";
import SelectField from "@jskit-ai/http-web/client/components/SelectField";
import { calculate, formulaRecord, isCalculated, isFileField, isRollup, isWorkedOut, showValue } from "@local/apps/shared";
import { appsApi, errorText } from "./appsApi.js";
import { useLinkPickers } from "./linkPickers.js";
import { SHARED_TYPES, TEXT_INPUT, inputOf, personChoices, storedOf } from "./fieldValues.js";
import RecordFileField from "./RecordFileField.vue";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

// Adding or editing one record in the Data tab (D-35). Inputs follow the field types; links pick a
// record of the target table, searched on the server as the person types. Calculated fields (D-78)
// show what they work out to from the values typed, and are never typed in. The server checks every
// value again. A file or picture (D-130) is uploaded once the record is saved, as the server stores it at the record's place;
// only taking one away is part of the save itself.
const props = defineProps({
  open: { type: Boolean, default: false },
  table: { type: Object, default: null },
  tables: { type: Array, default: () => [] },
  record: { type: Object, default: null },
  // The home's people ({ id, name }), for person fields.
  people: { type: Array, default: () => [] }
});
// `changed`: the record was saved, but a file after it failed: the table reads it again while the dialog stays open.
const emit = defineEmits(["update:open", "saved", "changed"]);

const draft = reactive({});
// The files chosen for file and picture fields, by field id, uploaded after the save.
const chosen = reactive({});
// The record this dialog made, when a file then failed to upload: saving again saves onto it, never a second record.
const made = ref(null);
// Why a file chosen didn't go on once the record was saved, by field id, shown under its field.
const fileProblems = reactive({});
// The records that link to this one (D-130), by table: a contact's to-dos, events and deals. Read when it opens.
const related = ref([]);
const relatedLoading = ref(false);
// The read failed: Related says so, with Try again. Only the latest read counts, for the record open now.
const relatedFailed = ref(false);
let relatedRead = 0;
const paths = usePaths();
const titleOf = (group, record) => {
  const value = record[group.table.titleFieldId];
  return value && typeof value === "object" ? value.label : value || `#${record.id}`;
};
async function loadRelated(record) {
  const read = ++relatedRead;
  related.value = [];
  relatedFailed.value = false;
  relatedLoading.value = Boolean(record);
  if (!record) return;
  try {
    const { groups } = await appsApi.relatedRecords(props.table.key, record.id);
    if (read === relatedRead) related.value = groups;
  } catch {
    if (read === relatedRead) relatedFailed.value = true;
  } finally {
    if (read === relatedRead) relatedLoading.value = false;
  }
}
const links = useLinkPickers();
const saving = ref(false);
const problem = ref("");
const fields = computed(() => (props.table?.fields || []).filter((field) => !field.obsolete && !isWorkedOut(field)));
const calculatedFields = computed(() => (props.table?.fields || []).filter((field) => !field.obsolete && isCalculated(field)));
// Calculated fields and roll-ups (D-140), shown as they are worked out, never typed in.
const workedOutFields = computed(() => (props.table?.fields || []).filter((field) => !field.obsolete && isWorkedOut(field)));
const workedOut = (field) => (isRollup(field) ? (props.record?.[field.id] ?? null) : worked.value[field.key]);
const workedHint = (field) =>
  isRollup(field) ? `The ${field.options.rollup.measure} of the ${field.options.rollup.from} records linked to this one` : `Calculated: ${field.options.formula}`;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const labelOf = (field) => field.label + (field.options?.required ? " *" : "");

const toInput = (field, value) => {
  if (SHARED_TYPES.has(field.type)) return inputOf(field, value);
  if (value === null || value === undefined) return field.type === "yesno" ? false : null;
  if (field.type === "money") return String(Number(value) / 100);
  if (field.type === "link") return value.id;
  return value;
};
const toStored = (field, value) => {
  if (SHARED_TYPES.has(field.type)) return storedOf(field, value);
  if (value === "" || value === undefined) return null;
  if (field.type === "money") return value === null ? null : Math.round(Number(value) * 100);
  if (field.type === "number") return value === null ? null : Number(value);
  return value;
};

watch(() => [props.open, props.record], () => {
  if (!props.open) return;
  problem.value = "";
  for (const key of Object.keys(draft)) delete draft[key];
  for (const key of Object.keys(chosen)) delete chosen[key];
  for (const key of Object.keys(fileProblems)) delete fileProblems[key];
  made.value = null;
  for (const field of fields.value) draft[field.id] = toInput(field, props.record?.[field.id]);
  loadRelated(props.record);
  links.open(fields.value, props.tables, props.record);
}, { immediate: true });

const problemOf = (field) => {
  const value = draft[field.id];
  if (isFileField(field)) return field.options?.required && !value && !chosen[field.id] ? `${field.label} is required` : "";
  if (field.options?.required && (value === null || value === "" || (Array.isArray(value) && !value.length))) return `${field.label} is required`;
  if (field.type === "email" && value && !EMAIL.test(value)) return "Enter a valid email";
  if (["number", "money"].includes(field.type) && value !== null && value !== "" && !Number.isFinite(Number(value))) return "Enter a number";
  return "";
};
const valid = computed(() => fields.value.every((field) => !problemOf(field)));
const worked = computed(() => {
  if (!calculatedFields.value.length) return {};
  const typed = Object.fromEntries(fields.value.map((field) => [field.key, toStored(field, draft[field.id])]));
  return calculate(props.table, formulaRecord(props.table, typed));
});

async function save() {
  saving.value = true;
  problem.value = "";
  for (const key of Object.keys(fileProblems)) delete fileProblems[key];
  let wrote = false;
  try {
    // A file field is sent only to take its file away; a new file goes up on its own once the record exists.
    const record = props.record || made.value;
    const sent = fields.value.filter((field) => !isFileField(field) || (record?.[field.id] && !draft[field.id]));
    const values = Object.fromEntries(sent.map((field) => [field.id, toStored(field, draft[field.id])]));
    let saved = record ? await appsApi.updateRecord(props.table.key, record.id, values) : await appsApi.createRecord(props.table.key, values);
    wrote = true;
    made.value = props.record ? null : saved;
    for (const field of fields.value.filter((entry) => chosen[entry.id])) {
      try {
        saved = await appsApi.attachFile(props.table.key, saved.id, field.id, chosen[field.id]);
      } catch (error) {
        // The record is in; this file isn't. Its field says why, and Save tries it again.
        fileProblems[field.id] = errorText(error, "That file didn't upload.");
        continue;
      }
      made.value = props.record ? null : saved;
      draft[field.id] = saved[field.id];
      chosen[field.id] = null;
    }
    if (Object.keys(fileProblems).length) {
      problem.value = "The record is saved; the file marked above didn't go on.";
      emit("changed");
      return;
    }
    emit("saved", saved);
    emit("update:open", false);
  } catch (error) {
    problem.value = errorText(error, "Saving didn't work.");
    if (wrote) emit("changed");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-dialog :model-value="open" max-width="560" @update:model-value="emit('update:open', $event)">
    <v-card v-if="table" rounded="lg" class="pa-4">
      <div class="text-h6 mb-4">{{ record ? `Edit ${table.label}` : `New in ${table.label}` }}</div>
      <template v-for="field in fields" :key="field.id">
        <!-- readable-check: allow selection-field - data: a choice field's options are part of its table's definition, which the dialog was given -->
        <v-select v-if="field.type === 'choice'" v-model="draft[field.id]" :items="field.options?.choices || []" :label="labelOf(field)" :error-messages="problemOf(field)" variant="outlined" density="comfortable" clearable />
        <SelectField v-else-if="field.type === 'link'" v-model="draft[field.id]" :items="links.choices[field.id] || []" :loading="Boolean(links.loading[field.id])" searchable no-filter :label="labelOf(field)" :error-messages="problemOf(field)" variant="outlined" density="comfortable" clearable @update:search="(text) => links.search(field.id, text, draft[field.id])" />
        <v-switch v-else-if="field.type === 'yesno'" v-model="draft[field.id]" :label="field.label" color="primary" inset hide-details class="mb-4" />
        <!-- readable-check: allow selection-field - data: the home's people come with the Data tab's tables, read once -->
        <v-select v-else-if="field.type === 'person'" v-model="draft[field.id]" :items="personChoices(people, record?.[field.id])" item-title="name" item-value="id" :label="labelOf(field)" :error-messages="problemOf(field)" variant="outlined" density="comfortable" clearable />
        <!-- readable-check: allow selection-field - data: a tags field's allowed tags are part of its table's definition, which the dialog was given -->
        <v-combobox v-else-if="field.type === 'tags'" v-model="draft[field.id]" :items="field.options?.choices || []" :label="labelOf(field)" :error-messages="problemOf(field)" multiple chips closable-chips variant="outlined" density="comfortable" />
        <RecordFileField
          v-else-if="isFileField(field)"
          v-model:current="draft[field.id]"
          v-model:chosen="chosen[field.id]"
          :field="field"
          :error-messages="problemOf(field) || fileProblems[field.id] || ''"
        />
        <v-textarea v-else-if="field.type === 'longtext'" v-model="draft[field.id]" :label="labelOf(field)" :error-messages="problemOf(field)" auto-grow rows="3" variant="outlined" density="comfortable" />
        <v-text-field
          v-else
          v-model="draft[field.id]"
          :type="TEXT_INPUT[field.type] || 'text'"
          :step="field.type === 'money' ? '0.01' : undefined"
          :label="labelOf(field)"
          :error-messages="problemOf(field)"
          variant="outlined"
          density="comfortable"
        />
      </template>
      <v-text-field
        v-for="field in workedOutFields"
        :key="field.id"
        :model-value="showValue(field, workedOut(field))"
        :label="field.label"
        :hint="workedHint(field)"
        persistent-hint
        readonly
        variant="outlined"
        density="comfortable"
        class="mb-2"
      />
      <section v-if="record && (relatedLoading || relatedFailed || related.length)" class="mb-4" data-testid="record-related">
        <div class="text-subtitle-2 mb-2">Related</div>
        <v-skeleton-loader v-if="relatedLoading" type="list-item@2" />
        <p v-else-if="relatedFailed" class="d-flex align-center flex-wrap ga-2 text-body-2 text-on-surface-variant mb-0" role="alert">
          The records linked to this one didn't load.
          <v-btn size="small" variant="text" @click="loadRelated(record)">Try again</v-btn>
        </p>
        <div v-for="group in related" v-else :key="group.field.id" class="mb-2">
          <router-link :to="paths.page(`/apps/data/${group.table.key}`)" class="text-body-2">
            {{ group.table.label }}{{ related.filter((other) => other.table.id === group.table.id).length > 1 ? ` (${group.field.label})` : "" }}
          </router-link>
          <span class="text-body-2 text-on-surface-variant"> · {{ group.total }}</span>
          <div class="d-flex flex-wrap ga-1 mt-1">
            <v-chip v-for="item in group.records" :key="item.id" size="small" variant="tonal">{{ titleOf(group, item) }}</v-chip>
            <span v-if="group.total > group.records.length" class="text-caption text-on-surface-variant align-self-center">and {{ group.total - group.records.length }} more</span>
          </div>
        </div>
      </section>
      <v-alert v-if="problem" type="error" variant="tonal" density="compact" class="mb-3">{{ problem }}</v-alert>
      <div class="d-flex justify-end ga-2">
        <v-btn variant="text" @click="emit('update:open', false)">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!valid || saving" @click="save">{{ saving ? "Saving…" : "Save" }}</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
