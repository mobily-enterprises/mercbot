<script setup>
import { computed } from "vue";
import { useDisplay } from "vuetify";
import { SHORTCUT_GROUPS } from "./shortcuts.js";

// Shortcuts sheet (Ctrl+/): two columns grouped by area, with the keys that really work here, in the shared dialog
// frame (docs/ui-style.md, section 6), which fills the screen on a phone.
const open = defineModel({ type: Boolean, default: false });
const columns = [SHORTCUT_GROUPS.slice(0, 2), SHORTCUT_GROUPS.slice(2)];
const display = useDisplay();
const phone = computed(() => display.width.value < 600);
</script>

<template>
  <v-dialog v-model="open" width="auto" :fullscreen="phone">
    <div class="mb-ctemp mb-shortcuts-sheet" :class="{ 'mb-ctemp--phone': phone }" role="dialog" aria-labelledby="mb-shortcuts-title">
      <div class="mb-ctemp__head">
        <button v-if="phone" type="button" class="mb-ctemp__close" aria-label="Close" @click="open = false">
          <v-icon icon="$close" size="18" />
        </button>
        <h2 id="mb-shortcuts-title" class="mb-ctemp__title">Keyboard shortcuts</h2>
        <button v-if="!phone" type="button" class="mb-ctemp__close" aria-label="Close" @click="open = false">
          <v-icon icon="$close" size="14" />
        </button>
      </div>
      <div class="mb-ctemp__body mb-ctemp__scroll">
        <div class="mb-shortcuts">
          <div v-for="(column, columnIndex) in columns" :key="columnIndex" class="mb-shortcuts__column">
            <section v-for="group in column" :key="group.title" class="mb-shortcuts__group">
              <h3 class="mb-shortcuts__title">{{ group.title }}</h3>
              <div v-for="item in group.items" :key="item.label" class="mb-shortcuts__row">
                <span>
                  {{ item.label }}
                  <span v-if="item.note" class="mb-shortcuts__note">{{ item.note }}</span>
                </span>
                <span class="mb-shortcuts__keys">
                  <template v-for="(combo, comboIndex) in item.keys" :key="comboIndex">
                    <span v-if="comboIndex > 0" class="mb-shortcuts__or">or</span>
                    <kbd v-for="key in combo" :key="key">{{ key }}</kbd>
                  </template>
                </span>
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped src="./MercbotChangeTemplateDialog.css"></style>
<style scoped>
/* As tall as its shortcuts, not the size of a gallery; on a phone the frame fills the screen and the sheet scrolls. */
.mb-shortcuts-sheet:not(.mb-ctemp--phone) {
  height: auto;
}

.mb-shortcuts {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 24px;
}

.mb-shortcuts__group + .mb-shortcuts__group {
  margin-top: 20px;
}

.mb-shortcuts__title {
  margin-bottom: 8px;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-shortcuts__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  min-height: 32px;
  font-size: 13px;
}

.mb-shortcuts__note {
  display: block;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-shortcuts__keys {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
}

.mb-shortcuts__keys kbd {
  min-width: 22px;
  padding: 1px 6px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-container-high));
  font: 12px/18px var(--v-font-body);
  text-align: center;
}

.mb-shortcuts__or {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
