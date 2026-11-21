<script setup>
import { computed, ref } from "vue";
import { addAccountStep, sharedWith } from "./appsCatalogue.js";
import { signInInThisTab } from "./signInReturn.js";

// The Add account step (D-110), the same on an app's page in Connect apps and from a bot's connect card: a label, which
// may stay empty (the account is then shown by its address), that everyone in the home and their bots will use it
// (D-111), what happens next, and the button that does it, never disabled for want of a label.
const props = defineProps({
  plugin: { type: Object, required: true },
  homeName: { type: String, default: "this home" },
  busy: { type: Boolean, default: false }
});
const emit = defineEmits(["add", "cancel"]);

const step = computed(() => addAccountStep(props.plugin, signInInThisTab()));
const shared = computed(() => sharedWith(props.plugin, props.homeName));
const label = ref("");

function submit() {
  emit("add", { label: label.value.trim() });
}
</script>

<template>
  <form class="mb-add-account" @submit.prevent="submit">
    <label class="mb-add-account__field">
      <span class="mb-add-account__name">Label (optional)</span>
      <input
        v-model="label"
        class="mb-add-account__input"
        aria-label="Label for the new account (optional)"
        placeholder="e.g. Work"
        maxlength="80"
        autofocus
        @keydown.esc.stop.prevent="emit('cancel')"
      >
    </label>
    <p class="mb-add-account__shared">{{ shared }}</p>
    <p class="mb-add-account__note">{{ step.note }}</p>
    <div class="mb-add-account__actions">
      <button type="button" class="mb-add-account__pill" @click="emit('cancel')">Cancel</button>
      <button type="submit" class="mb-add-account__pill mb-add-account__pill--primary" :disabled="busy">{{ step.submit }}</button>
    </div>
  </form>
</template>

<style scoped>
.mb-add-account {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
  text-align: left;
}

.mb-add-account__field {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px 10px;
}

.mb-add-account__name {
  min-width: 110px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-add-account__input {
  flex: 1;
  min-width: 160px;
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgb(var(--v-theme-outline));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 14px;
}

.mb-add-account__shared {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
}

.mb-add-account__note {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-add-account__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
}

.mb-add-account__pill {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 15px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mb-add-account__pill--primary {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.mb-add-account__pill:disabled {
  opacity: 0.6;
  cursor: default;
}
</style>
