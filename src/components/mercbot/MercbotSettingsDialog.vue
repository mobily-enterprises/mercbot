<script setup>
import { useDisplay } from "vuetify";
import { computed, ref, watch } from "vue";
import extensions from "./extensions.js";
import MercbotSettingsAbout from "./MercbotSettingsAbout.vue";
import MercbotSettingsComputer from "./MercbotSettingsComputer.vue";
import MercbotSettingsFiles from "./MercbotSettingsFiles.vue";
import MercbotSettingsLink from "./MercbotSettingsLink.vue";
import MercbotSettingsMemory from "./MercbotSettingsMemory.vue";
import MercbotSettingsPermissions from "./MercbotSettingsPermissions.vue";
import MercbotSettingsGeneral from "./MercbotSettingsGeneral.vue";
import MercbotSettingsUsage from "./MercbotSettingsUsage.vue";
import MercbotSettingsVault from "./MercbotSettingsVault.vue";
import { SETTINGS_SECTIONS, listedSections } from "./settingsSections.js";

// Settings: a window over the app with a section list on the left and the
// chosen section's cards on the right. Every control applies at once; ×, Escape or a click
// outside closes it.
// On a phone it fills the screen and shows one thing at a time: the chosen section, with a back
// arrow to the list of sections (D-36 UX bar).
const display = useDisplay();
const phone = computed(() => display.width.value < 600);
const listing = ref(false);
const open = defineModel({ type: Boolean, default: false });
// The sections a copy built on Mercbot adds (extensions.js): each one not for everyone is asked whether the person sees
// it once, the first time Settings opens; one whose answer failed is asked again the next time. One with the `value` of
// a section of Mercbot's own shows its component in that section's place.
const shown = ref(new Set());
const asked = new Set();
watch(
  open,
  (value) => {
    if (!value) return;
    listing.value = false;
    for (const entry of extensions.settingsSections) {
      if (!entry.visible || asked.has(entry.value)) continue;
      asked.add(entry.value);
      entry.visible().then(
        (yes) => {
          if (yes) shown.value = new Set([...shown.value, entry.value]);
        },
        () => asked.delete(entry.value)
      );
    }
  },
  { immediate: true }
);
const sections = computed(() => listedSections(extensions.settingsSections, shown.value));

function choose(value) {
  section.value = value;
  listing.value = false;
}
const section = defineModel("section", { type: String, default: "general" });
defineProps({
  theme: { type: String, default: "system" },
  displayName: { type: String, default: "" },
  initials: { type: String, default: "" }
});
const emit = defineEmits(["theme", "failure", "notify", "connect"]);
// The Vault's New item menu sits in the title row; it tells the Vault which dialog to open, or to
// import a CSV file.
const vaultCreate = ref("");
const current = computed(() => sections.value.find((entry) => entry.value === section.value) || SETTINGS_SECTIONS[0]);
</script>

<template>
  <v-dialog v-model="open" width="900" scrim="scrim" :opacity="0.5" :fullscreen="phone">
    <div class="mb-settings" :class="{ 'mb-settings--phone': phone }" role="dialog" aria-label="Settings">
      <nav v-if="!phone || listing" class="mb-settings__nav" aria-label="Settings sections">
        <button
          v-for="entry in sections"
          :key="entry.value"
          type="button"
          class="mb-settings__nav-row"
          :class="{ 'mb-settings__nav-row--selected': section === entry.value }"
          :aria-current="section === entry.value ? 'page' : undefined"
          @click="choose(entry.value)"
        >
          <v-icon :icon="entry.icon" size="16" />
          {{ entry.title }}
        </button>
      </nav>
      <div v-if="!phone || !listing" class="mb-settings__main">
        <div class="mb-settings__head">
          <v-btn v-if="phone" variant="text" @click="listing = true">All settings</v-btn>
          <h2 class="mb-settings__title">{{ current.title }}</h2>
          <v-menu v-if="section === 'vault' && !current.component" location="bottom end" :offset="4" content-class="mb-popover">
            <template #activator="{ props: newProps }">
              <button v-bind="newProps" type="button" class="mb-set-pill mb-set-pill--dark">New item <v-icon icon="$expand" size="14" /></button>
            </template>
            <v-list density="compact" class="py-1" width="200">
              <v-list-item min-height="32" class="px-3" @click="vaultCreate = 'login'"><span class="mb-settings__menu">Login</span></v-list-item>
              <v-list-item min-height="32" class="px-3" @click="vaultCreate = 'card'"><span class="mb-settings__menu">Card</span></v-list-item>
              <v-list-item min-height="32" class="px-3" @click="vaultCreate = 'contact'"><span class="mb-settings__menu">Contact info</span></v-list-item>
              <v-divider class="my-1" />
              <v-list-item min-height="32" class="px-3" @click="vaultCreate = 'import'"><span class="mb-settings__menu">Import from a CSV file</span></v-list-item>
            </v-list>
          </v-menu>
        </div>
        <button type="button" class="mb-settings__close" aria-label="Close settings" @click="open = false">
          <v-icon icon="$close" size="18" />
        </button>
        <div class="mb-settings__content">
          <component :is="current.component" v-if="current.component" @failure="emit('failure', $event)" @notify="emit('notify', $event)" />
          <MercbotSettingsGeneral
            v-else-if="section === 'general'"
            :theme="theme"
            :display-name="displayName"
            :initials="initials"
            @theme="emit('theme', $event)"
            @failure="emit('failure', $event)"
            @notify="emit('notify', $event)"
          />
          <MercbotSettingsComputer v-else-if="section === 'computer'" @failure="emit('failure', $event)" @notify="emit('notify', $event)" />
          <MercbotSettingsPermissions v-else-if="section === 'permissions'" @failure="emit('failure', $event)" />
          <MercbotSettingsFiles v-else-if="section === 'files'" @failure="emit('failure', $event)" @notify="emit('notify', $event)" @connect="emit('connect', $event)" />
          <MercbotSettingsMemory v-else-if="section === 'memory'" @failure="emit('failure', $event)" />
          <MercbotSettingsVault v-else-if="section === 'vault'" v-model:create="vaultCreate" @failure="emit('failure', $event)" />
          <MercbotSettingsUsage v-else-if="section === 'usage'" @failure="emit('failure', $event)" @notify="emit('notify', $event)" />
          <MercbotSettingsLink v-else-if="section === 'link'" @failure="emit('failure', $event)" @notify="emit('notify', $event)" />
          <MercbotSettingsAbout v-else @notify="emit('notify', $event)" />
        </div>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.mb-settings {
  display: flex;
  height: min(655px, calc(100vh - 48px));
  overflow: hidden;
  border-radius: 16px;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-surface));
}

.mb-settings__nav {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: 2px;
  width: 198px;
  padding: 13px;
  border-right: 1px solid rgb(var(--v-theme-outline-variant));
}

.mb-settings__nav-row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 32px;
  padding: 0 10px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.mb-settings__nav-row:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-settings__nav-row--selected,
.mb-settings__nav-row--selected:hover {
  background: rgb(var(--v-theme-outline-variant));
}

.mb-settings__main {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.mb-settings__head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  max-width: 716px;
  padding: 32px 40px 18px;
}

.mb-settings__title {
  margin: 0;
  font-size: 18px;
  font-weight: 400;
}

.mb-settings__menu {
  font-size: 13px;
}

.mb-settings__close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 16px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-settings__close:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-settings__content {
  flex: 1;
  padding: 0 40px 24px;
  overflow-y: auto;
}

/* Phone: the whole screen, one column; a row's control goes under its words. */
.mb-settings--phone {
  height: 100%;
  border-radius: 0;
}

.mb-settings--phone .mb-settings__nav {
  flex: 1;
  width: auto;
  padding: 56px 16px 16px;
  border-right: 0;
}

.mb-settings--phone .mb-settings__nav-row {
  height: 44px;
  font-size: 15px;
}

.mb-settings--phone .mb-settings__head {
  justify-content: flex-start;
  gap: 8px;
  padding: 18px 56px 14px 12px;
}

.mb-settings--phone .mb-settings__content {
  padding: 0 16px 24px;
}

.mb-settings--phone :deep(.mb-set-row) {
  flex-wrap: wrap;
}

.mb-settings--phone :deep(.mb-set-row__text) {
  flex-basis: 100%;
}
</style>
