<script setup>
import { SHORTCUT_GROUPS } from "./shortcuts.js";

// Shortcuts sheet (Ctrl+/): two columns grouped by area, with the keys that really work here.
const open = defineModel({ type: Boolean, default: false });
const columns = [SHORTCUT_GROUPS.slice(0, 2), SHORTCUT_GROUPS.slice(2)];
</script>

<template>
  <v-dialog v-model="open" max-width="760">
    <v-card rounded="xl" class="pa-4">
      <v-card-title class="text-title-large">Keyboard shortcuts</v-card-title>
      <v-card-text>
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
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
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
