<script setup>
import { computed, defineAsyncComponent, inject } from "vue";
import AppForm from "./AppForm.vue";
import { FIELD_REFERENCE, ICON_PATHS, groupLabel, refersToRemovedField, showValue } from "./appRuntime.js";
import { APP_FORM_KEY, APP_SCREEN_KEY, NO_APP_FORM, useAppArea } from "./screenKeys.js";

// Chart.js loads only on screens that show a chart.
const AppChart = defineAsyncComponent(() => import("./AppChart.vue"));
// Views load only on screens that show one, and they draw AppNode themselves.
const AppViewPart = defineAsyncComponent(() => import("./AppViewPart.vue"));

// One part of an app screen (D-35): only the catalog's parts, drawn with Vuetify and the app's
// theme, restyled as the app's own CSS likes (`app-node--<type>`, and `.x-<name>` for each name in
// the part's `class`). `path` is where the part sits in the stored screen, so a button can ask the
// server to run exactly its own steps.
defineOptions({ name: "AppNode" });

const props = defineProps({
  node: { type: Object, required: true },
  path: { type: String, required: true },
  scope: { type: Object, default: () => ({}) }
});

/** @type {import("../../types.js").ScreenRuntime} */
const runtime = inject(APP_SCREEN_KEY);
const appArea = useAppArea();
const classes = computed(() => [`app-node--${props.node.type}`, ...String(props.node.class || "").split(/\s+/u).filter(Boolean).map((name) => `x-${name}`)]);
/** @type {import("../../types.js").AppForm} */
const form = inject(APP_FORM_KEY, NO_APP_FORM);
const tones = { success: "success", warning: "warning", danger: "error", primary: "primary", neutral: undefined };
const sizes = { headline: "text-h5", title: "text-h6", body: "text-body-1" };

const value = (setting, scope = props.scope) => runtime.evaluate(setting, scope);
const visible = computed(() => props.node.showIf === undefined || value(props.node.showIf) === true);
const queryName = computed(() => runtime.referenced(props.node.rows));
const isLoading = (name) => Boolean(name) && runtime.loading.has(name);

// A plain field reference is shown by the field's type (dates, money, links, yes/no).
function shown(setting, scope = props.scope, record = null, table = null) {
  const match = FIELD_REFERENCE.exec(String(setting || ""));
  if (match && record && table) {
    const field = table.fields.find((entry) => entry.key === match[1]);
    if (field) return showValue(field, record[field.key]);
  }
  const result = value(setting, scope);
  return result === undefined || result === null || result === "" ? "—" : String(result);
}

// `field` parts: "=data.<query>.<field>" reads the record directly.
const fieldSource = computed(() => {
  const match = /^=data\.(\w+)\.\w+$/u.exec(String(props.node.value || ""));
  return match ? { record: runtime.data[match[1]], table: runtime.queryTable(match[1]), name: match[1] } : null;
});

const rows = computed(() => (Array.isArray(runtime.data[queryName.value]) ? runtime.data[queryName.value] : []));
const columns = computed(() => (props.node.columns || []).filter((column) => !refersToRemovedField(column.value)));
const rowScope = (record) => runtime.rowScope(props.node.rows, record);
const maxTotal = computed(() => Math.max(1, ...rows.value.map((item) => Math.abs(item.total ?? item.count ?? 0))));
const totalsQuery = computed(() => runtime.screen.data?.[queryName.value]);
const groupField = computed(() => runtime.queryTable(queryName.value)?.fields.find((entry) => entry.key === totalsQuery.value?.groupBy) || null);
const measureField = computed(() => runtime.queryTable(queryName.value)?.fields.find((entry) => entry.key === (totalsQuery.value?.sum || totalsQuery.value?.avg)) || null);
const totalText = (item) => (measureField.value ? showValue(measureField.value, item.total) : String(item.count));
// One figure across every group, when the query asks for it.
const grandTotalText = computed(() => {
  const grand = runtime.grandTotals?.[queryName.value];
  if (!grand) return "";
  return measureField.value && props.node.measure !== "count" ? showValue(measureField.value, grand.total) : String(grand.count);
});

const stateName = computed(() => String(props.node.bind || "").split(".")[1]);
const inputValue = computed({
  get: () => runtime.state?.[stateName.value],
  set: (next) => {
    if (runtime.state) runtime.state[stateName.value] = props.node.inputType === "number" ? Number(next || 0) : (next ?? "");
  }
});

function press(record = null) {
  const steps = `${props.path}/do`;
  if (form !== NO_APP_FORM) return form.submit(steps);
  return runtime.run(steps, { row: record?.id ?? props.scope.record?.id ?? null });
}
const openRow = (record) => props.node.onRowClick && runtime.run(`${props.path}/onRowClick`, { row: record.id });
const tabKey = computed(() => props.path);
</script>

<template>
  <!-- display: contents — the wrapper only marks where the part sits, for Point and ask. -->
  <div v-if="visible" class="app-node" :class="classes" :data-app-path="path" :data-app-type="node.type" :data-app-label="String(value(node.label) ?? value(node.value) ?? '')">
    <div v-if="node.type === 'row'" class="d-flex align-center flex-wrap ga-3">
      <AppNode v-for="(child, index) in node.content" :key="index" :node="child" :path="`${path}/content/${index}`" :scope="scope" />
    </div>

    <v-row v-else-if="node.type === 'grid'" dense>
      <v-col v-for="(child, index) in node.content" :key="index" cols="12" :md="12 / (node.columns || 1)">
        <AppNode :node="child" :path="`${path}/content/${index}`" :scope="scope" />
      </v-col>
    </v-row>

    <template v-else-if="node.type === 'text'">
      <v-skeleton-loader v-if="fieldSource && isLoading(fieldSource.name)" type="heading" width="240" />
      <span v-else :class="sizes[node.size || 'body']">{{ shown(node.value, scope, fieldSource?.record, fieldSource?.table) }}</span>
    </template>

    <v-chip v-else-if="node.type === 'chip'" size="small" :color="tones[value(node.tone)]" variant="tonal">{{ value(node.value) }}</v-chip>

    <v-spacer v-else-if="node.type === 'spacer'" />

    <v-btn
      v-else-if="node.type === 'button'"
      :color="node.emphasis === 'primary' ? 'primary' : undefined"
      :variant="node.emphasis === 'primary' ? 'flat' : 'text'"
      :prepend-icon="ICON_PATHS[node.icon]"
      :disabled="value(node.disabled) === true || runtime.busy.value"
      @click.stop="press()"
    >
      {{ value(node.label) }}
    </v-btn>

    <v-text-field
      v-else-if="node.type === 'input'"
      v-model="inputValue"
      :label="value(node.label)"
      :type="node.inputType || 'text'"
      :prepend-inner-icon="ICON_PATHS[node.icon]"
      density="comfortable"
      variant="outlined"
      hide-details
      clearable
      class="app-input"
    />

    <v-card v-else-if="node.type === 'table'" flat>
      <v-table hover>
        <thead>
          <tr>
            <th v-for="column in columns" :key="column.label">{{ column.label }}</th>
            <th v-if="node.rowActions?.length" class="text-right app-actions-column" />
          </tr>
        </thead>
        <tbody v-if="isLoading(queryName)">
          <tr v-for="index in 4" :key="index">
            <td v-for="column in columns" :key="column.label"><v-skeleton-loader type="text" /></td>
            <td v-if="node.rowActions?.length" />
          </tr>
        </tbody>
        <tbody v-else>
          <tr v-for="(record, rowIndex) in rows" :key="record.id ?? rowIndex" :class="{ 'app-clickable': node.onRowClick }" @click="openRow(record)">
            <td v-for="column in columns" :key="column.label">
              <v-chip v-if="column.display === 'chip'" size="small" variant="tonal">{{ shown(column.value, rowScope(record), record, rowScope(record).table) }}</v-chip>
              <template v-else>{{ shown(column.value, rowScope(record), record, rowScope(record).table) }}</template>
            </td>
            <td v-if="node.rowActions?.length" class="text-right text-no-wrap">
              <AppNode v-for="(action, index) in node.rowActions" :key="index" :node="action" :path="`${path}/rowActions/${index}`" :scope="rowScope(record)" />
            </td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="columns.length + 1" class="text-medium-emphasis">
              {{ runtime.attention[queryName] ? "This list needs attention: it uses a field that has been removed. Ask the Builder to tidy it." : "Nothing here yet." }}
            </td>
          </tr>
        </tbody>
      </v-table>
    </v-card>

    <div v-else-if="node.type === 'field'" class="py-2">
      <div class="text-caption text-medium-emphasis">{{ value(node.label) }}</div>
      <v-skeleton-loader v-if="fieldSource && isLoading(fieldSource.name)" type="text" width="180" />
      <div v-else class="text-body-1">{{ shown(node.value, scope, fieldSource?.record, fieldSource?.table) }}</div>
    </div>

    <AppForm v-else-if="node.type === 'form'" :node="node" :path="path" :scope="scope" />

    <v-card v-else-if="node.type === 'totals'" flat class="pa-4">
      <div class="text-subtitle-1 mb-3">{{ value(node.label) }}</div>
      <template v-if="isLoading(queryName)">
        <v-skeleton-loader v-for="index in 3" :key="index" type="text" />
      </template>
      <div v-else-if="!rows.length" class="text-medium-emphasis text-body-2">Nothing to count yet.</div>
      <div v-for="item in rows" v-else :key="String(item.key)" class="mb-3">
        <div class="d-flex justify-space-between text-body-2">
          <span>{{ groupLabel(groupField, item) }} <span class="text-medium-emphasis">· {{ item.count }}</span></span>
          <strong>{{ totalText(item) }}</strong>
        </div>
        <v-progress-linear :model-value="(Math.abs(item.total ?? item.count) / maxTotal) * 100" color="primary" rounded height="6" />
      </div>
      <div v-if="grandTotalText && !isLoading(queryName)" class="d-flex justify-space-between text-body-2 mt-2"><span>Total</span><strong>{{ grandTotalText }}</strong></div>
    </v-card>

    <v-card v-else-if="node.type === 'chart'" flat class="pa-4">
      <div v-if="node.label" class="text-subtitle-1 mb-3">{{ value(node.label) }}</div>
      <v-skeleton-loader v-if="isLoading(queryName)" type="image" height="260" />
      <div v-else-if="!rows.length" class="text-medium-emphasis text-body-2">No data yet.</div>
      <AppChart v-else :kind="node.kind || 'bar'" :label="String(value(node.label) ?? '')" :rows="rows" :field="groupField" :measure-field="measureField" :measure="node.measure || 'count'" />
      <div v-if="grandTotalText && !isLoading(queryName)" class="d-flex justify-space-between text-body-2 mt-2"><span>Total</span><strong>{{ grandTotalText }}</strong></div>
    </v-card>

    <AppViewPart v-else-if="node.type === 'view'" :node="node" :path="path" :scope="scope" />

    <div v-else-if="node.type === 'tabs'">
      <v-tabs v-model="runtime.dialogs[tabKey]" color="primary" class="mb-4">
        <v-tab v-for="(tab, index) in node.tabs" :key="tab.title" :value="index">{{ tab.title }}</v-tab>
      </v-tabs>
      <v-window v-model="runtime.dialogs[tabKey]">
        <v-window-item v-for="(tab, index) in node.tabs" :key="tab.title" :value="index">
          <div class="d-flex flex-column ga-4">
            <AppNode v-for="(child, childIndex) in tab.content" :key="childIndex" :node="child" :path="`${path}/tabs/${index}/content/${childIndex}`" :scope="scope" />
          </div>
        </v-window-item>
      </v-window>
    </div>

    <v-dialog v-else-if="node.type === 'dialog'" v-model="runtime.dialogs[`dialog:${node.key}`]" max-width="560" :attach="appArea || undefined" :class="classes">
      <v-card rounded="lg" class="pa-4">
        <div v-if="node.title" class="text-h6 mb-3">{{ value(node.title) }}</div>
        <div class="d-flex flex-column ga-4">
          <AppNode v-for="(child, index) in node.content" :key="index" :node="child" :path="`${path}/content/${index}`" :scope="scope" />
        </div>
      </v-card>
    </v-dialog>
  </div>
</template>

<style scoped>
.app-node {
  display: contents;
}
.app-input {
  max-width: 360px;
}
.app-clickable {
  cursor: pointer;
}
.app-actions-column {
  width: 1%;
}
</style>
