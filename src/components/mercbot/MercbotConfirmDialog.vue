<script setup>
// A centred confirmation for something that can't be undone.
const open = defineModel({ type: Boolean, default: false });
defineProps({
  title: { type: String, required: true },
  text: { type: String, default: "" },
  confirmLabel: { type: String, default: "Delete" },
  // Group dialogs dim the page to about half black.
  dim: { type: Boolean, default: false }
});
const emit = defineEmits(["confirm"]);

function confirm() {
  emit("confirm");
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" width="320" scrim="scrim" :opacity="dim ? 0.5 : 0.06">
    <div class="mb-confirm">
      <p class="mb-confirm__title" :class="{ 'mb-confirm__title--alone': !text }">{{ title }}</p>
      <p v-if="text" class="mb-confirm__text">{{ text }}</p>
      <div class="mb-confirm__actions">
        <button type="button" class="mb-confirm__button" @click="open = false">Cancel</button>
        <button type="button" class="mb-confirm__button mb-confirm__button--danger" @click="confirm">{{ confirmLabel }}</button>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.mb-confirm {
  padding: 20px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-confirm__title {
  margin: 0 0 6px;
  font-size: 15px;
  font-weight: 700;
}

.mb-confirm__title--alone {
  margin-bottom: 18px;
}

.mb-confirm__text {
  margin: 0 0 18px;
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-confirm__actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.mb-confirm__button {
  height: 34px;
  border: 0;
  border-radius: 17px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.mb-confirm__button--danger {
  background: rgb(var(--v-theme-error));
  color: rgb(var(--v-theme-on-error));
}
</style>
