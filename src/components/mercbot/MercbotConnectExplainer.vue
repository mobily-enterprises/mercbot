<script setup>
import MercbotPluginLogo from "./MercbotPluginLogo.vue";

// Before signing in from a chat card: what connecting means.
defineProps({
  plugin: { type: Object, default: null },
  botName: { type: String, default: "your bot" }
});
const open = defineModel({ type: Boolean, default: false });
const emit = defineEmits(["continue"]);
</script>

<template>
  <v-dialog v-model="open" width="380">
    <div v-if="plugin" class="mb-explainer">
      <button type="button" class="mb-explainer__close" aria-label="Close" @click="open = false">
        <v-icon icon="$close" size="18" />
      </button>
      <MercbotPluginLogo :plugin="plugin" :size="56" />
      <h2 class="mb-explainer__title">Link {{ plugin.name }} to Mercbot</h2>
      <p class="mb-explainer__subtitle">So {{ botName }} can work in {{ plugin.name }} for you.</p>
      <ul class="mb-explainer__points">
        <li><v-icon icon="$check" size="16" />Nothing gets changed or sent without a yes from you first.</li>
        <li><v-icon icon="$check" size="16" />{{ plugin.name }} handles the login on its own page, so {{ botName }} only gets a key, not your password.</li>
        <li><v-icon icon="$check" size="16" />Changed your mind? Unlink it from Connect apps in one click.</li>
      </ul>
      <p class="mb-explainer__note">All your linked apps are listed under Connect apps.</p>
      <button type="button" class="mb-explainer__continue" @click="emit('continue', plugin)">Continue</button>
    </div>
  </v-dialog>
</template>

<style scoped>
.mb-explainer {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 560px;
  padding: 56px 24px 24px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  text-align: center;
}

.mb-explainer__close {
  position: absolute;
  top: 12px;
  right: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-explainer__title {
  margin: 20px 0 6px;
  font-size: 18px;
  font-weight: 700;
}

.mb-explainer__subtitle {
  margin: 0 0 24px;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-explainer__points {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  margin: 0;
  padding: 16px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-high));
  list-style: none;
  font-size: 13px;
  line-height: 18px;
  text-align: left;
}

.mb-explainer__points li {
  display: flex;
  gap: 10px;
}

.mb-explainer__note {
  margin: 16px 0 0;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-explainer__continue {
  width: 100%;
  height: 40px;
  margin-top: auto;
  border: 0;
  border-radius: 20px;
  background: rgb(var(--v-theme-inverse-surface));
  font: inherit;
  font-size: 14px;
  color: rgb(var(--v-theme-inverse-on-surface));
  cursor: pointer;
}
</style>
