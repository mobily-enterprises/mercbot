<script setup>
import { onMounted, ref } from "vue";
import { appsApi, errorText } from "./appsApi.js";

// Removing a field (D-35): shows exactly what will change, warns when a list will show more, and
// applies everything in one save when the person confirms. The data itself is kept.
const props = defineProps({ fieldId: { type: String, required: true } });
const emit = defineEmits(["done", "cancel"]);

const impact = ref(null);
const problem = ref("");
const removing = ref(false);
const result = ref(null);

onMounted(async () => {
  try {
    impact.value = await appsApi.fieldImpact(props.fieldId);
  } catch (error) {
    problem.value = errorText(error, "Couldn't check what uses this field.");
  }
});

const kinds = { column: "column", "form field": "form field", filter: "filter", sort: "sorting", total: "total", totals: "totals", part: "part" };
const describe = (use) => {
  const parts = [...new Set(use.changes.map((change) => kinds[change.kind] || change.kind))];
  return `${use.app}${use.version === "draft" ? " (draft)" : ""}: ${parts.join(", ")}`;
};

async function remove() {
  removing.value = true;
  try {
    result.value = await appsApi.removeField(props.fieldId);
    emit("done", result.value);
  } catch (error) {
    problem.value = errorText(error, "Removing didn't work.");
  } finally {
    removing.value = false;
  }
}
</script>

<template>
  <div class="field-removal">
    <v-skeleton-loader v-if="!impact && !problem" type="paragraph" />
    <template v-else-if="impact">
      <div class="text-body-1 mb-2">Remove <strong>{{ impact.field.label }}</strong> from {{ impact.table.label }}?</div>
      <template v-if="result">
        <div class="text-body-2">Removed. {{ result.affected.length ? `Updated ${result.affected.length} app version${result.affected.length === 1 ? "" : "s"}.` : "No app used it." }} The data is kept.</div>
      </template>
      <template v-else-if="impact.field.obsolete">
        <div class="text-body-2 text-medium-emphasis">This field has already been removed.</div>
      </template>
      <template v-else>
        <div v-if="!impact.uses.length" class="text-body-2 mb-2">No app uses it.</div>
        <ul v-else class="text-body-2 mb-2 field-removal__list">
          <li v-for="use in impact.uses" :key="use.slug + use.version">{{ describe(use) }}</li>
        </ul>
        <v-alert v-if="impact.calculated?.length" type="warning" variant="tonal" density="compact" class="mb-2">
          {{ impact.calculated.map((field) => field.label).join(", ") }} {{ impact.calculated.length === 1 ? "is" : "are" }} worked out from it, and will show “—” until the Builder changes {{ impact.calculated.length === 1 ? "its formula" : "their formulas" }}.
        </v-alert>
        <template v-for="use in impact.uses" :key="`w-${use.slug}-${use.version}`">
          <v-alert v-for="entry in use.widened" :key="entry.screen + entry.query" type="warning" variant="tonal" density="compact" class="mb-2">
            {{ use.app }} › {{ entry.screen }}: the list “{{ entry.query }}” filters on {{ impact.field.label }}. Without that condition, it will show more records.
          </v-alert>
        </template>
        <div class="text-body-2 text-medium-emphasis mb-3">The data is kept, and every changed app gets a new version you can restore.</div>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="emit('cancel')">Keep it</v-btn>
          <v-btn color="error" variant="flat" :disabled="removing" @click="remove">{{ removing ? "Removing…" : "Remove everywhere" }}</v-btn>
        </div>
      </template>
    </template>
    <v-alert v-if="problem" type="error" variant="tonal" density="compact" class="mt-2">{{ problem }}</v-alert>
  </div>
</template>

<style scoped>
.field-removal__list {
  padding-left: 20px;
}
</style>
