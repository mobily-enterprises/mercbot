<script setup>
import { ref } from "vue";
import FieldRemoval from "./FieldRemoval.vue";

// The Builder asked to remove a field (D-35). Nothing happens until a person confirms here; the
// removal then runs as that person.
const props = defineProps({ message: { type: Object, required: true } });
const state = ref("asking");
</script>

<template>
  <section class="mb-field-removal" :aria-label="`Remove ${props.message.body.field}`">
    <div class="text-caption text-medium-emphasis mb-1">Remove a field · {{ props.message.body.table }}</div>
    <div v-if="state === 'kept'" class="text-body-2">Kept {{ props.message.body.field }}.</div>
    <FieldRemoval v-else :field-id="props.message.body.fieldId" @cancel="state = 'kept'" @done="state = 'removed'" />
  </section>
</template>

<style scoped>
.mb-field-removal {
  max-width: 480px;
  padding: 12px 16px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 16px;
}
</style>
