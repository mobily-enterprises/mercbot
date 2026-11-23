<script setup>
import { computed, reactive, ref, watch } from "vue";
import SelectField from "@jskit-ai/http-web/client/components/SelectField";
import { calculate, formulaRecord, isCalculated, showValue } from "@local/apps/shared";
import { appsApi, errorText } from "./appsApi.js";
import { useLinkPickers } from "./linkPickers.js";
import { SHARED_TYPES, TEXT_INPUT, inputOf, storedOf } from "./fieldValues.js";
import RecordFileField from "./RecordFileField.vue";

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
const emit = defineEmits(["update:open", "saved"]);

const draft = reactive({});
// The files chosen for file and picture fields, by field id, uploaded after the save.
const chosen = reactive({});
const FILES = new Set(["file", "image"]);
// The record this dialog made, when a file then failed to upload: saving again saves onto it, never a second record.
const made = ref(null);
const links = useLinkPickers();
const saving = ref(false);
const problem = ref("");
const fields = computed(() => (props.table?.fields || []).filter((field) => !field.obsolete && !isCalculated(field)));
const calculatedFields = computed(() => (props.table?.fields || []).filter((field) => !field.obsolete && isCalculated(field)));
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

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
  made.value = null;
  for (const field of fields.value) draft[field.id] = toInput(field, props.record?.[field.id]);
  links.open(fields.value, props.tables, props.record);
}, { immediate: true });

const problemOf = (field) => {
  const value = draft[field.id];
  if (FILES.has(field.type)) return field.options?.required && !value && !chosen[field.id] ? `${field.label} is required` : "";
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
  try {
    // A file field is sent only to take its file away; a new file goes up on its own once the record exists.
    const record = props.record || made.value;
    const sent = fields.value.filter((field) => !FILES.has(field.type) || (record?.[field.id] && !draft[field.id]));
    const values = Object.fromEntries(sent.map((field) => [field.id, toStored(field, draft[field.id])]));
    let saved = record ? await appsApi.updateRecord(props.table.key, record.id, values) : await appsApi.createRecord(props.table.key, values);
    made.value = props.record ? null : saved;
    for (const field of fields.value.filter((entry) => chosen[entry.id])) {
      saved = await appsApi.attachFile(props.table.key, saved.id, field.id, chosen[field.id]);
      made.value = props.record ? null : saved;
      draft[field.id] = saved[field.id];
      chosen[field.id] = null;
    }
    emit("saved", saved);
    emit("update:open", false);
  } catch (error) {
    problem.value = errorText(error, "Saving didn't work.");
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
        <v-select v-if="field.type === 'choice'" v-model="draft[field.id]" :items="field.options?.choices || []" :label="field.label + (field.options?.required ? ' *' : '')" :error-messages="problemOf(field)" variant="outlined" density="comfortable" clearable />
        <SelectField v-else-if="field.type === 'link'" v-model="draft[field.id]" :items="links.choices[field.id] || []" :loading="Boolean(links.loading[field.id])" searchable no-filter :label="field.label + (field.options?.required ? ' *' : '')" :error-messages="problemOf(field)" variant="outlined" density="comfortable" clearable @update:search="(text) => links.search(field.id, text, draft[field.id])" />
        <v-switch v-else-if="field.type === 'yesno'" v-model="draft[field.id]" :label="field.label" color="primary" inset hide-details class="mb-4" />
        <!-- readable-check: allow selection-field - data: the home's people come with the Data tab's tables, read once -->
        <v-select v-else-if="field.type === 'person'" v-model="draft[field.id]" :items="people" item-title="name" item-value="id" :label="field.label + (field.options?.required ? ' *' : '')" :error-messages="problemOf(field)" variant="outlined" density="comfortable" clearable />
        <!-- readable-check: allow selection-field - data: a tags field's allowed tags are part of its table's definition, which the dialog was given -->
        <v-combobox v-else-if="field.type === 'tags'" v-model="draft[field.id]" :items="field.options?.choices || []" :label="field.label + (field.options?.required ? ' *' : '')" :error-messages="problemOf(field)" multiple chips closable-chips variant="outlined" density="comfortable" />
        <RecordFileField
          v-else-if="FILES.has(field.type)"
          v-model:current="draft[field.id]"
          v-model:chosen="chosen[field.id]"
          :field="field"
          :error-messages="problemOf(field)"
        />
        <v-textarea v-else-if="field.type === 'longtext'" v-model="draft[field.id]" :label="field.label + (field.options?.required ? ' *' : '')" :error-messages="problemOf(field)" auto-grow rows="3" variant="outlined" density="comfortable" />
        <v-text-field
          v-else
          v-model="draft[field.id]"
          :type="TEXT_INPUT[field.type] || 'text'"
          :step="field.type === 'money' ? '0.01' : undefined"
          :label="field.label + (field.options?.required ? ' *' : '')"
          :error-messages="problemOf(field)"
          variant="outlined"
          density="comfortable"
        />
      </template>
      <v-text-field
        v-for="field in calculatedFields"
        :key="field.id"
        :model-value="showValue(field, worked[field.key])"
        :label="field.label"
        :hint="`Calculated: ${field.options.formula}`"
        persistent-hint
        readonly
        variant="outlined"
        density="comfortable"
        class="mb-2"
      />
      <v-alert v-if="problem" type="error" variant="tonal" density="compact" class="mb-3">{{ problem }}</v-alert>
      <div class="d-flex justify-end ga-2">
        <v-btn variant="text" @click="emit('update:open', false)">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!valid || saving" @click="save">{{ saving ? "Saving…" : "Save" }}</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
