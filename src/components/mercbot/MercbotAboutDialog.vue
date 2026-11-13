<script setup>
import { computed, ref } from "vue";
import iconUrl from "../../../favicon.svg";
import { versionInfo } from "./accountApi.js";

// About Mercbot: our icon, name, version and build, and a button that copies the
// version details, briefly saying so.
const open = defineModel({ type: Boolean, default: false });
const emit = defineEmits(["failure"]);
const info = versionInfo();
const copied = ref(false);
const builtOn = computed(() => (info.builtAt ? new Date(info.builtAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }) : "a development build"));

async function copy() {
  const lines = [
    `Version: ${info.version}`,
    `Built: ${info.builtAt || "development"}`,
    `Channel: ${info.channel}`,
    `System: ${info.platform}`
  ];
  try {
    await navigator.clipboard.writeText(lines.join("\n"));
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1300);
  } catch (error) {
    emit("failure", error);
  }
}
</script>

<template>
  <v-dialog v-model="open" width="360" scrim="scrim" :opacity="0.5">
    <div class="mb-about">
      <button type="button" class="mb-about__close" aria-label="Close" @click="open = false">
        <v-icon icon="$close" size="16" />
      </button>
      <img class="mb-about__icon" :src="iconUrl" alt="" width="64" height="64">
      <p class="mb-about__name">Mercbot</p>
      <p class="mb-about__line">Version {{ info.version }}</p>
      <p class="mb-about__line">Built {{ builtOn }}</p>
      <p class="mb-about__copyright">© {{ new Date().getFullYear() }} Gigsnet Pty Ltd</p>
      <button type="button" class="mb-about__copy" @click="copy">{{ copied ? "Copied" : "Copy version info" }}</button>
    </div>
  </v-dialog>
</template>

<style scoped>
.mb-about {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 28px 24px 24px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-about__close {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-about__icon {
  border-radius: 14px;
}

.mb-about__name {
  margin: 12px 0 4px;
  font-size: 20px;
  font-weight: 700;
}

.mb-about__line {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-about__copyright {
  margin: 6px 0 16px;
  font-size: 11px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-about__copy {
  height: 30px;
  padding: 0 16px;
  border: 0;
  border-radius: 15px;
  background: rgb(var(--v-theme-surface-container-high));
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}
</style>
