<script setup>
import { computed, onBeforeUnmount, ref, watchEffect } from "vue";
import { useTheme } from "vuetify";
import { DEFAULT_THEME, onColor } from "@local/apps/shared";
import { pageMatchesMedia, pageMediaQuery } from "@/browser.js";

// An app's look (D-35, stage 3), through Vuetify only: a theme made from Mercbot's light or dark
// colours with the app's primary colour, defaults for density and corners, and one of a few font
// stacks. Wraps an app inside Mercbot and a public app.
const props = defineProps({ theme: { type: Object, default: () => DEFAULT_THEME } });

const vuetify = useTheme();
const prefersDark = ref(pageMatchesMedia("(prefers-color-scheme: dark)"));
const media = pageMediaQuery("(prefers-color-scheme: dark)");
const follow = (event) => (prefersDark.value = event.matches);
media?.addEventListener("change", follow);
onBeforeUnmount(() => media?.removeEventListener("change", follow));

const look = computed(() => ({ ...DEFAULT_THEME, ...(props.theme || {}) }));
const dark = computed(() => look.value.mode === "dark" || (look.value.mode === "system" && prefersDark.value));
const name = computed(() => `app-${dark.value ? "dark" : "light"}-${look.value.color.slice(1).toLowerCase()}`);

// Registered once per colour and mode; Mercbot's own light or dark colours with the app's primary.
watchEffect(() => {
  if (vuetify.themes.value[name.value]) return;
  const base = vuetify.themes.value[dark.value ? "dark" : "light"];
  vuetify.themes.value[name.value] = { dark: dark.value, colors: { ...base.colors, primary: look.value.color, "on-primary": onColor(look.value.color) }, variables: { ...base.variables } };
});

const ROUNDED = { square: 0, soft: "lg", round: "xl" };
const defaults = computed(() => {
  const rounded = ROUNDED[look.value.corners];
  const field = { rounded };
  return {
    global: { density: look.value.density === "compact" ? "compact" : undefined },
    VBtn: { rounded },
    VCard: { rounded },
    VTextField: field,
    VSelect: field,
    VCombobox: field,
    VAutocomplete: field,
    VTextarea: field
  };
});
</script>

<template>
  <v-theme-provider :theme="name" with-background>
    <v-defaults-provider :defaults="defaults">
      <div class="app-theme" :class="`app-theme--${look.font}`">
        <slot :look="look" />
      </div>
    </v-defaults-provider>
  </v-theme-provider>
</template>

<style scoped>
.app-theme {
  display: contents;
}
.app-theme--classic :deep(*) {
  font-family: "Helvetica Neue", Arial, sans-serif;
}
.app-theme--serif :deep(*) {
  font-family: Georgia, "Times New Roman", serif;
}
.app-theme--rounded :deep(*) {
  font-family: ui-rounded, "SF Pro Rounded", "Nunito", system-ui, sans-serif;
}
</style>
