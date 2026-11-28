<script setup>
import { computed, inject, onBeforeUnmount, provide, reactive, watch } from "vue";
import { calculate, celSchema, isFileField, isRollup, isWorkedOut, limitProblem } from "@local/apps/shared";
import AppNode from "./AppNode.vue";
import { formulaRecord, refersToRemovedField, showValue } from "./appRuntime.js";
import { APP_FORM_KEY, APP_SCREEN_KEY } from "./screenKeys.js";
import { EMAIL, SHARED_TYPES, TEXT_INPUT, inputOf, personChoices, refreshedDraft, storedOf } from "./fieldValues.js";
import SelectField from "@jskit-ai/http-web/client/components/SelectField";
import RecordFileField from "./RecordFileField.vue";
import { appsApi, errorText } from "./appsApi.js";
import { formOnScreen } from "./appSnapshot.js";

// A form (D-35). Inputs come from the field types; the app only lists field names. Money is typed
// in units and stored in cents; a link is picked from its table's records, searched on the server as the person types,
// only those the app's people (or a public app's visitors) may read. A calculated field
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
// The file field being uploaded or taken away, and what went wrong.
// `round` remounts the file inputs after each try, so the same file can be chosen again.
const attaching = reactive({ field: "", failed: "", problem: "", round: 0, percent: null });

const entries = computed(() => (props.node.fields || [])
  .map((entry) => (typeof entry === "string" ? { field: entry } : entry))
  .filter((entry) => !refersToRemovedField(entry.field))
  // A form may name a field its own way ({ field, label }), as an app does a shared table's general field.
  .map((entry) => {
    const def = table.value?.fields.find((field) => field.key === entry.field);
    return { ...entry, def: def && entry.label ? { ...def, label: entry.label } : def };
  })
  .filter((entry) => entry.def && !(isFileField(entry.def) && !(creating.value ? runtime.filesOnNew : runtime.attachesFiles))));
// A create form's chosen files and pictures, by field: they go onto the record once its button has made it.
const pending = reactive({});

// A link field's picker: the record it links to now, and the records it can be set to, read through the screen's
// runtime (a page of 100, or those whose title has what was typed), so a visitor sees only what they may read.
const links = reactive({ now: {}, choices: {}, loading: {} });
const searching = {};
async function findLinks(key, text = "") {
  clearTimeout(searching[key]);
  searching[key] = setTimeout(async () => {
    links.loading[key] = true;
    try {
      const items = await runtime.linkChoices(props.path, key, text);
      const now = links.now[key];
      links.choices[key] = now && !items.some((item) => item.value === now.value) ? [now, ...items] : items;
    } catch {
      links.choices[key] = links.now[key] ? [links.now[key]] : [];
    } finally {
      links.loading[key] = false;
    }
  }, text ? 300 : 0);
}
const linkItems = (key) => links.choices[key] || (links.now[key] ? [links.now[key]] : []);

// Values as typed: money in units, links as the linked record's id.
const toInput = (field, value) => {
  if (SHARED_TYPES.has(field.type)) return inputOf(field, value);
  if (value === null || value === undefined) return field.type === "yesno" ? false : "";
  if (field.type === "money") return String(Number(value) / 100);
  if (field.type === "link") {
    links.now[field.key] = { value: String(value.id), title: String(value.label ?? `#${value.id}`) };
    return String(value.id);
  }
  return value;
};
const toStored = (field, value) => {
  if (SHARED_TYPES.has(field.type)) return storedOf(field, value);
  if (field.type === "money") return value === "" || value === null ? null : Math.round(Number(value) * 100);
  if (field.type === "number") return value === "" || value === null ? null : Number(value);
  if (field.type === "link") return value === "" || value === null || value === undefined ? null : String(value);
  return value === "" ? null : value;
};

// A new record's empty fields aren't wrong yet: their problems show once the person has typed there.
const touched = reactive(new Set());
function reset(next = record.value) {
  touched.clear();
  for (const key of Object.keys(pending)) delete pending[key];
  for (const key of Object.keys(draft)) delete draft[key];
  for (const field of table.value?.fields || []) draft[field.key] = toInput(field, next?.[field.key]);
}
// Read again while open (a live screen, D-144): what the person typed stays, the rest shows the record as it is now.
watch(record, (next, previous) => {
  const fields = table.value?.fields || [];
  const fresh = refreshedDraft(fields, draft, touched, previous, next, toInput);
  if (!fresh.touched.size) return reset(next);
  Object.assign(draft, fresh.draft);
  touched.clear();
  fresh.touched.forEach((key) => touched.add(key));
}, { immediate: true });

const typedIn = (entry) => !isFileField(entry.def) && !isWorkedOut(entry.def);

/** How much of the file going up has gone, in percent, which its field shows. */
const uploading = (percent) => {
  attaching.percent = percent;
};

/** A chosen file onto the record at once, or (`file` null) the record's taken away; the screen's lists read it again. */
async function attach(entry, file) {
  // One at a time: the file fields take nothing while one goes up.
  if (attaching.field) return;
  attaching.field = entry.field;
  attaching.failed = "";
  attaching.percent = null;
  try {
    // By the field's name: an app's tables come without field ids.
    if (file) await appsApi.attachFile(table.value.key, record.value.id, entry.field, file, uploading);
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
const labelOf = (entry) => entry.def.label + (required(entry) ? " *" : "");
const problem = (entry) => {
  if (isWorkedOut(entry.def)) return "";
  const value = draft[entry.field];
  const blank = value === "" || value === null || value === undefined || (Array.isArray(value) && !value.length);
  if (required(entry) && blank) return `${entry.def.label} is required`;
  if (entry.def.type === "email" && value && !EMAIL.test(value)) return "Enter a valid email";
  if (["number", "money"].includes(entry.def.type) && value !== "" && value !== null && !Number.isFinite(Number(value))) return "Enter a number";
  // The field's own min, max and pattern (D-140), as the server checks them.
  const limit = limitProblem(entry.def, toStored(entry.def, value));
  return limit ? `${entry.def.label} ${limit}` : "";
};
const valid = computed(() => entries.value.filter(shown).every((entry) => !problem(entry)));
const shownProblem = (entry) => (creating.value && !touched.has(entry.field) ? "" : problem(entry));
const changed = computed(() => entries.value.some((entry) => String(draft[entry.field] ?? "") !== String(toInput(entry.def, record.value?.[entry.field]) ?? "")));
const buttonScope = computed(() => formScope(valid.value, changed.value));

// What this form shows now, for the app's chat (D-147): read as the person sends a message (appSnapshot.js).
const onScreen = () => formOnScreen({
  table: table.value,
  record: record.value,
  creating: creating.value,
  entries: entries.value.filter(shown),
  draft,
  toInput
});
const forms = runtime.forms;
forms?.set(props.path, onScreen);
onBeforeUnmount(() => forms?.delete(props.path));

// After a create form's button succeeds, it's empty again for the next one.
provide(APP_FORM_KEY, {
  submit: async (steps) => {
    const result = await runtime.run(steps, { formValues: storedValues() });
    if (!result || !creating.value) return;
    // The record this form's button made, and the files chosen for it, each put on once it exists.
    const made = (result.created || []).find((entry) => entry.table === table.value?.key && entry.files);
    const chosen = Object.entries(pending).filter(([field, file]) => file && made?.files.includes(field));
    reset(null);
    for (const [field, file] of chosen) {
      attaching.field = field;
      attaching.percent = null;
      try {
        await runtime.attachNew(made, field, file, uploading);
      } catch (error) {
        attaching.failed = field;
        attaching.problem = `Saved, but this file didn't upload: ${errorText(error, "please try again from the record.")}`;
      } finally {
        attaching.field = "";
      }
    }
    if (chosen.length) await runtime.reloadChanged([table.value.id]);
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
            v-if="isWorkedOut(entry.def)"
            :model-value="showValue(entry.def, worked[entry.field])"
            :label="entry.def.label"
            :hint="isRollup(entry.def) ? 'Adds up the records linked to this one' : 'Calculated'"
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
            :label="labelOf(entry)"
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
            :label="labelOf(entry)"
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
            :label="labelOf(entry)"
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
            :label="labelOf(entry)"
            :error-messages="shownProblem(entry)"
            @update:model-value="touched.add(entry.field)"
            variant="outlined"
            density="comfortable"
            clearable
          />
          <RecordFileField
            v-else-if="isFileField(entry.def) && creating"
            :field="entry.def"
            :chosen="pending[entry.field] || null"
            :error-messages="attaching.failed === entry.field ? attaching.problem : ''"
            :busy="attaching.field === entry.field"
            :progress="attaching.percent"
            :disabled="Boolean(attaching.field)"
            @update:chosen="(file) => { pending[entry.field] = file; attaching.failed = ''; }"
          />
          <RecordFileField
            v-else-if="isFileField(entry.def)"
            :key="`${entry.field}:${attaching.round}`"
            :field="entry.def"
            :current="record?.[entry.field] || null"
            :chosen="null"
            :error-messages="attaching.failed === entry.field ? attaching.problem : ''"
            :busy="attaching.field === entry.field"
            :progress="attaching.percent"
            :disabled="Boolean(attaching.field)"
            @update:chosen="(file) => file && attach(entry, file)"
            @update:current="(value) => value === null && attach(entry, null)"
          />
          <v-switch v-else-if="entry.def.type === 'yesno'" v-model="draft[entry.field]" :label="entry.def.label" color="primary" inset hide-details class="mb-4" />
          <SelectField
            v-else-if="entry.def.type === 'link'"
            v-model="draft[entry.field]"
            :items="linkItems(entry.field)"
            :loading="Boolean(links.loading[entry.field])"
            searchable
            no-filter
            :clearable="!entry.def.options?.required"
            :label="entry.def.label"
            variant="outlined"
            density="comfortable"
            class="mb-2"
            @focus="!links.choices[entry.field] && findLinks(entry.field)"
            @update:search="(text) => findLinks(entry.field, text)"
          />
          <v-text-field
            v-else
            v-model="draft[entry.field]"
            :type="TEXT_INPUT[entry.def.type] || 'text'"
            :step="entry.def.type === 'money' ? '0.01' : undefined"
            :label="labelOf(entry)"
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
