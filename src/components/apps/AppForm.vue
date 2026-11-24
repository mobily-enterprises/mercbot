<script setup>
import { computed, inject, provide, reactive, watch } from "vue";
import { calculate, celSchema, isCalculated } from "@local/apps/shared";
import AppNode from "./AppNode.vue";
import { formulaRecord, refersToRemovedField, showValue } from "./appRuntime.js";
import { APP_FORM_KEY, APP_SCREEN_KEY } from "./screenKeys.js";
import { SHARED_TYPES, TEXT_INPUT, inputOf, personChoices, storedOf } from "./fieldValues.js";
import RecordFileField from "./RecordFileField.vue";
import { appsApi, errorText } from "./appsApi.js";

// A form (D-35). Inputs come from the field types; the app only lists field names. Money is typed
// in units and stored in cents; links are shown, and changed in the Data tab. A calculated field
// (D-78) is shown worked out from what is typed, never typed in. The server checks everything again
// and only writes the fields this form shows. A file or picture (D-130) goes onto the record as soon as it's chosen, on a
// form showing a record of the live app; a form adding a record leaves it out until the record exists.
const props = defineProps({
  node: { type: Object, required: true },
  path: { type: String, required: true },
  scope: { type: Object, default: () => ({}) }
});

/** @type {import("../../types.js").ScreenRuntime} */
const runtime = inject(APP_SCREEN_KEY);
// An edit form shows one record of a query; a create form (`table`) starts empty and adds one.
const creating = computed(() => Boolean(props.node.table));
const queryName = computed(() => (creating.value ? null : runtime.referenced(props.node.record)));
const table = computed(() => (creating.value ? runtime.tableNamed(props.node.table) : runtime.queryTable(queryName.value)));
const record = computed(() => (creating.value ? null : runtime.data[queryName.value]));
const loading = computed(() => !creating.value && runtime.loading.has(queryName.value));
const draft = reactive({});
const FILES = new Set(["file", "image"]);
// The file field being uploaded or taken away, and what went wrong.
// `round` remounts the file inputs after each try, so the same file can be chosen again.
const attaching = reactive({ field: "", failed: "", problem: "", round: 0 });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

const entries = computed(() => (props.node.fields || [])
  .map((entry) => (typeof entry === "string" ? { field: entry } : entry))
  .filter((entry) => !refersToRemovedField(entry.field))
  .map((entry) => ({ ...entry, def: table.value?.fields.find((field) => field.key === entry.field) }))
  .filter((entry) => entry.def && !(FILES.has(entry.def.type) && (creating.value || !runtime.attachesFiles))));

// Values as typed: money in units, links as their label.
const toInput = (field, value) => {
  if (SHARED_TYPES.has(field.type)) return inputOf(field, value);
  if (value === null || value === undefined) return field.type === "yesno" ? false : "";
  if (field.type === "money") return String(Number(value) / 100);
  if (field.type === "link") return value.label;
  return value;
};
const toStored = (field, value) => {
  if (SHARED_TYPES.has(field.type)) return storedOf(field, value);
  if (field.type === "money") return value === "" || value === null ? null : Math.round(Number(value) * 100);
  if (field.type === "number") return value === "" || value === null ? null : Number(value);
  return value === "" ? null : value;
};

// A new record's empty fields aren't wrong yet: their problems show once the person has typed there.
const touched = reactive(new Set());
function reset(next = record.value) {
  touched.clear();
  for (const key of Object.keys(draft)) delete draft[key];
  for (const field of table.value?.fields || []) draft[field.key] = toInput(field, next?.[field.key]);
}
watch(record, (next) => reset(next), { immediate: true });

const typedIn = (entry) => entry.def.type !== "link" && !FILES.has(entry.def.type) && !isCalculated(entry.def);

/** A chosen file onto the record at once, or (`file` null) the record's taken away; the screen's lists read it again. */
async function attach(entry, file) {
  // One at a time: the file fields take nothing while one goes up.
  if (attaching.field) return;
  attaching.field = entry.field;
  attaching.failed = "";
  try {
    // By the field's name: an app's tables come without field ids.
    if (file) await appsApi.attachFile(table.value.key, record.value.id, entry.field, file);
    else await appsApi.updateRecord(table.value.key, record.value.id, { [entry.field]: null });
    await runtime.reloadChanged([table.value.id]);
  } catch (error) {
    attaching.failed = entry.field;
    attaching.problem = errorText(error, "That file didn't upload.");
  } finally {
    attaching.round += 1;
    attaching.field = "";
  }
}
const storedValues = () => Object.fromEntries(entries.value.filter(typedIn).map((entry) => [entry.field, toStored(entry.def, draft[entry.field])]));

/** The record as the form holds it now, as formulas see it, its calculated fields worked out from what is typed. */
function formRecord(asFormulas) {
  const current = { ...formulaRecord(table.value, record.value) };
  for (const entry of entries.value) if (typedIn(entry)) current[entry.field] = formulaRecord(table.value, { [entry.field]: toStored(entry.def, draft[entry.field]) })[entry.field];
  return table.value ? calculate(table.value, current, { asFormulas }) : current;
}
const worked = computed(() => formRecord(false));

function formScope(valid = true, changed = false) {
  return {
    variables: { form: { ...celSchema(table.value), valid: "bool", changed: "bool", values: "map" } },
    values: { form: { ...formRecord(true), valid, changed, values: storedValues() } }
  };
}

const shown = (entry) => entry.showIf === undefined || runtime.evaluate(entry.showIf, formScope()) === true;
const required = (entry) => entry.def.options?.required || runtime.evaluate(entry.required, formScope()) === true;
const problem = (entry) => {
  if (isCalculated(entry.def)) return "";
  const value = draft[entry.field];
  const blank = value === "" || value === null || value === undefined || (Array.isArray(value) && !value.length);
  if (required(entry) && blank) return `${entry.def.label} is required`;
  if (entry.def.type === "email" && value && !EMAIL.test(value)) return "Enter a valid email";
  if (["number", "money"].includes(entry.def.type) && value !== "" && value !== null && !Number.isFinite(Number(value))) return "Enter a number";
  return "";
};
const valid = computed(() => entries.value.filter(shown).every((entry) => !problem(entry)));
const shownProblem = (entry) => (creating.value && !touched.has(entry.field) ? "" : problem(entry));
const changed = computed(() => entries.value.some((entry) => String(draft[entry.field] ?? "") !== String(toInput(entry.def, record.value?.[entry.field]) ?? "")));
const buttonScope = computed(() => formScope(valid.value, changed.value));

// After a create form's button succeeds, it's empty again for the next one.
provide(APP_FORM_KEY, {
  submit: async (steps) => {
    if ((await runtime.run(steps, { formValues: storedValues() })) && creating.value) reset(null);
  }
});
</script>

<template>
  <v-card flat class="pa-4 app-form">
    <template v-if="loading">
      <v-skeleton-loader v-for="index in entries.length || 3" :key="index" type="text" class="mb-4" />
    </template>
    <div v-else-if="!creating && !record" class="text-medium-emphasis">This record doesn't exist.</div>
    <template v-else>
      <template v-for="entry in entries" :key="entry.field">
        <template v-if="shown(entry)">
          <v-text-field
            v-if="isCalculated(entry.def)"
            :model-value="showValue(entry.def, worked[entry.field])"
            :label="entry.def.label"
            hint="Calculated"
            persistent-hint
            readonly
            variant="outlined"
            density="comfortable"
            class="mb-2"
            data-testid="app-form-calculated"
          />
          <!-- readable-check: allow selection-field - data: the home's people come with the app, read once when it opens -->
          <v-select
            v-else-if="entry.def.type === 'person'"
            v-model="draft[entry.field]"
            :items="personChoices(runtime.people || [], record?.[entry.field])"
            item-title="name"
            item-value="id"
            :label="entry.def.label + (required(entry) ? ' *' : '')"
            :error-messages="shownProblem(entry)"
            @update:model-value="touched.add(entry.field)"
            variant="outlined"
            density="comfortable"
            clearable
          />
          <!-- readable-check: allow selection-field - data: a tags field's allowed tags are part of its table's definition, read with the form -->
          <v-combobox
            v-else-if="entry.def.type === 'tags'"
            v-model="draft[entry.field]"
            :items="entry.def.options?.choices || []"
            :label="entry.def.label + (required(entry) ? ' *' : '')"
            :error-messages="shownProblem(entry)"
            @update:model-value="touched.add(entry.field)"
            multiple
            chips
            closable-chips
            variant="outlined"
            density="comfortable"
          />
          <v-textarea
            v-else-if="entry.def.type === 'longtext'"
            v-model="draft[entry.field]"
            :label="entry.def.label + (required(entry) ? ' *' : '')"
            :error-messages="shownProblem(entry)"
            @update:model-value="touched.add(entry.field)"
            auto-grow
            rows="3"
            variant="outlined"
            density="comfortable"
          />
          <!-- readable-check: allow selection-field - data: a choice field's options are part of its table's definition, read with the form -->
          <v-select
            v-else-if="entry.def.type === 'choice'"
            v-model="draft[entry.field]"
            :items="entry.def.options?.choices || []"
            :label="entry.def.label + (required(entry) ? ' *' : '')"
            :error-messages="shownProblem(entry)"
            @update:model-value="touched.add(entry.field)"
            variant="outlined"
            density="comfortable"
            clearable
          />
          <template v-else-if="FILES.has(entry.def.type)">
            <RecordFileField
              :key="`${entry.field}:${attaching.round}`"
              :field="entry.def"
              :current="record?.[entry.field] || null"
              :chosen="null"
              :error-messages="attaching.failed === entry.field ? attaching.problem : ''"
              :busy="attaching.field === entry.field"
              :disabled="Boolean(attaching.field)"
              @update:chosen="(file) => file && attach(entry, file)"
              @update:current="(value) => value === null && attach(entry, null)"
            />
          </template>
          <v-switch v-else-if="entry.def.type === 'yesno'" v-model="draft[entry.field]" :label="entry.def.label" color="primary" inset hide-details class="mb-4" />
          <v-text-field
            v-else-if="entry.def.type === 'link'"
            :model-value="draft[entry.field] || '—'"
            :label="entry.def.label"
            hint="Change links in the Data tab"
            persistent-hint
            readonly
            variant="outlined"
            density="comfortable"
            class="mb-2"
          />
          <v-text-field
            v-else
            v-model="draft[entry.field]"
            :type="TEXT_INPUT[entry.def.type] || 'text'"
            :step="entry.def.type === 'money' ? '0.01' : undefined"
            :label="entry.def.label + (required(entry) ? ' *' : '')"
            :error-messages="shownProblem(entry)"
            @update:model-value="touched.add(entry.field)"
            variant="outlined"
            density="comfortable"
          />
        </template>
      </template>
      <div class="d-flex justify-end ga-2">
        <AppNode v-for="(button, index) in node.buttons" :key="index" :node="button" :path="`${path}/buttons/${index}`" :scope="buttonScope" />
      </div>
    </template>
  </v-card>
</template>

<style scoped>
.app-form {
  max-width: 640px;
}
</style>
