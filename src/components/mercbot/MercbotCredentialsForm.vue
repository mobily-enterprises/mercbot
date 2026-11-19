<script setup>
import { computed, reactive, ref } from "vue";
import { pluginsApi } from "./pluginsApi.js";

// An app's API credentials, entered by an owner or admin of the home (D-93): the fields its plugin.json declares, checked
// with the app before anything is saved. The app's page for making them opens from here once its address is typed.
const props = defineProps({
  plugin: { type: Object, required: true },
  account: { type: Object, required: true }
});
const emit = defineEmits(["saved", "cancel"]);

const values = reactive(Object.fromEntries(props.plugin.credentials.fields.map((field) => [field.id, ""])));
const saving = ref(false);
const problem = ref("");
const filled = computed(() => props.plugin.credentials.fields.every((field) => field.optional || String(values[field.id]).trim()));
// The app's own page for making credentials, at the address typed: one DNS label only.
const page = computed(() => {
  const link = props.plugin.credentials.page;
  const tenant = String(values.tenant || "").trim().toLowerCase();
  return link && /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(tenant) ? { label: link.label, url: link.url.replace("{tenant}", tenant) } : null;
});

async function save() {
  saving.value = true;
  problem.value = "";
  try {
    emit("saved", await pluginsApi.enterCredentials(props.account.id, { ...values }));
  } catch (error) {
    problem.value = error?.message || "That didn't work. Check the values and try again.";
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <form class="mb-credentials" :aria-label="`${plugin.name} API credentials`" @submit.prevent="save">
    <p class="mb-credentials__help">{{ plugin.credentials.help }}</p>
    <label v-for="field in plugin.credentials.fields" :key="field.id" class="mb-credentials__field">
      <span class="mb-credentials__label">{{ field.label }}<template v-if="field.optional"> (optional)</template></span>
      <span class="mb-credentials__input">
        <span v-if="field.prefix" class="mb-credentials__affix">{{ field.prefix }}</span>
        <input
          v-model="values[field.id]"
          :type="field.secret ? 'password' : 'text'"
          :maxlength="field.maxLength || 500"
          :autocomplete="field.secret ? 'new-password' : 'off'"
          spellcheck="false"
        >
        <span v-if="field.suffix" class="mb-credentials__affix">{{ field.suffix }}</span>
      </span>
      <span v-if="field.hint" class="mb-credentials__hint">{{ field.hint }}</span>
    </label>
    <a v-if="page" class="mb-credentials__page" :href="page.url" target="_blank" rel="noopener">{{ page.label }}</a>
    <span v-if="problem" class="mb-credentials__problem" role="alert">{{ problem }}</span>
    <div class="mb-credentials__actions">
      <button type="submit" class="mb-credentials__pill mb-credentials__pill--primary" :disabled="saving || !filled">
        {{ saving ? "Checking with " + plugin.name + "…" : "Save" }}
      </button>
      <button type="button" class="mb-credentials__pill" :disabled="saving" @click="emit('cancel')">Cancel</button>
    </div>
  </form>
</template>

<style scoped src="./MercbotCredentials.css"></style>
