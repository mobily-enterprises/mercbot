<script setup>
import { versionInfo } from "./accountApi.js";
import extensions from "./extensions.js";

// Settings → About: the version, and who keeps it current: a person's own
// copy is updated with `mercbot upgrade` (updatesLine), unless a copy built on Mercbot says otherwise (extensions.js).
const updatesLine = "Update this copy with mercbot upgrade on its computer.";
const emit = defineEmits(["notify"]);
const info = versionInfo();
const updates = extensions.aboutUpdates || updatesLine;

async function copy() {
  try {
    await navigator.clipboard.writeText(info.version);
    emit("notify", "Version copied");
  } catch {
    // Copying isn't allowed here; the version is still on screen.
  }
}
</script>

<template>
  <section>
    <p class="mb-set-group">Mercbot</p>
    <div class="mb-set-card">
      <div class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label mb-about-row__version">
            Version {{ info.version }}
            <button type="button" class="mb-about-row__copy" aria-label="Copy version" @click="copy">
              <v-icon icon="$contentCopy" size="13" />
            </button>
          </span>
          <span class="mb-set-row__description">{{ updates }}</span>
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mb-about-row__version {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.mb-about-row__copy {
  display: inline-flex;
  padding: 2px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}
</style>
