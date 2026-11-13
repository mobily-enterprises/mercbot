<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import { DEFAULT_THEME, THEME_CHOICES, checkTheme } from "@local/apps/shared";
import { APP_SWATCHES } from "@/theme/palettes.js";
import { appsApi, errorText } from "./appsApi.js";
import AppTheme from "./AppTheme.vue";

// How the home's apps look (D-35, stage 3): colour, light or dark, font, corners, density and a
// logo. Owners and admins change it; everyone sees it. Each app can change its colour and density
// in its own details.
const emit = defineEmits(["notify"]);
const LABELS = {
  mode: { light: "Light", dark: "Dark", system: "Follow the device" },
  font: { system: "Standard", classic: "Classic", serif: "Serif", rounded: "Rounded" },
  corners: { square: "Square", soft: "Soft", round: "Round" },
  density: { comfortable: "Comfortable", compact: "Compact" }
};

const draft = reactive({ ...DEFAULT_THEME });
const saved = ref("");
const canManage = ref(false);
const loading = ref(true);
const saving = ref(false);
const problems = computed(() => checkTheme({ ...draft }));
const changed = computed(() => JSON.stringify(draft) !== saved.value);
const items = (key) => THEME_CHOICES[key].map((value) => ({ value, title: LABELS[key][value] }));

onMounted(async () => {
  try {
    const { theme, canManage: manages } = await appsApi.theme();
    Object.assign(draft, DEFAULT_THEME, theme || {});
    canManage.value = manages;
    saved.value = JSON.stringify(draft);
  } catch (error) {
    emit("notify", errorText(error, "The look couldn't load."), "error");
  } finally {
    loading.value = false;
  }
});

function pickLogo(files) {
  const file = [].concat(files || [])[0];
  if (!file) return (draft.logo = null);
  const reader = new FileReader();
  reader.onload = () => (draft.logo = String(reader.result));
  reader.readAsDataURL(file);
}

async function save() {
  saving.value = true;
  try {
    Object.assign(draft, (await appsApi.setTheme({ ...draft })).theme);
    saved.value = JSON.stringify(draft);
    emit("notify", "Saved. Every app in this home uses the new look.");
  } catch (error) {
    emit("notify", errorText(error, "That couldn't be saved."), "error");
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <v-skeleton-loader v-if="loading" type="article, actions" />
  <div v-else class="apps-look">
    <div class="apps-look__form">
      <div class="text-body-2 text-medium-emphasis mb-3">How this home's apps look, inside Mercbot and on public pages. {{ canManage ? "" : "Only the home's owners and admins can change it." }}</div>
      <div class="text-body-2 mb-1">Colour</div>
      <div class="d-flex flex-wrap align-center ga-2 mb-2">
        <v-btn v-for="swatch in APP_SWATCHES" :key="swatch" :color="swatch" icon size="small" :disabled="!canManage" :aria-label="`Use ${swatch}`" :variant="draft.color === swatch ? 'elevated' : 'flat'" @click="draft.color = swatch" />
        <v-text-field v-model="draft.color" label="Or a colour code" variant="outlined" density="compact" hide-details :disabled="!canManage" class="apps-look__code" />
      </div>
      <!-- readable-check: allow selection-field - data: THEME_CHOICES (@local/apps/shared) and LABELS above are fixed lists -->
      <v-select v-model="draft.mode" :items="items('mode')" label="Light or dark" variant="outlined" density="comfortable" :disabled="!canManage" class="mb-2" />
      <!-- readable-check: allow selection-field - data: THEME_CHOICES (@local/apps/shared) and LABELS above are fixed lists -->
      <v-select v-model="draft.font" :items="items('font')" label="Font" variant="outlined" density="comfortable" :disabled="!canManage" class="mb-2" />
      <!-- readable-check: allow selection-field - data: THEME_CHOICES (@local/apps/shared) and LABELS above are fixed lists -->
      <v-select v-model="draft.corners" :items="items('corners')" label="Corners" variant="outlined" density="comfortable" :disabled="!canManage" class="mb-2" />
      <!-- readable-check: allow selection-field - data: THEME_CHOICES (@local/apps/shared) and LABELS above are fixed lists -->
      <v-select v-model="draft.density" :items="items('density')" label="Spacing" variant="outlined" density="comfortable" :disabled="!canManage" class="mb-2" />
      <div class="d-flex align-center ga-2 mb-2">
        <v-file-input accept="image/png,image/jpeg,image/webp" label="Logo (PNG, JPEG or WebP, up to 200 KB)" variant="outlined" density="comfortable" hide-details prepend-icon="" :disabled="!canManage" @update:model-value="pickLogo" />
        <v-btn v-if="draft.logo" variant="text" size="small" :disabled="!canManage" @click="draft.logo = null">Remove logo</v-btn>
      </div>
      <div v-for="problem in problems" :key="problem" class="text-body-2 text-error mb-1">{{ problem }}</div>
      <div v-if="canManage" class="d-flex justify-end mt-2">
        <v-btn color="primary" variant="flat" :disabled="saving || !changed || problems.length > 0" @click="save">{{ saving ? "Saving…" : "Save" }}</v-btn>
      </div>
    </div>

    <div class="apps-look__preview">
      <div class="text-body-2 text-medium-emphasis mb-2">Preview</div>
      <AppTheme :theme="{ ...draft }">
        <v-sheet color="surface-container-low" rounded="lg" class="pa-4">
          <div class="d-flex align-center ga-3 mb-4">
            <v-img v-if="draft.logo" :src="draft.logo" alt="" width="32" height="32" max-width="32" contain />
            <span class="text-h6">Your app</span>
          </div>
          <v-text-field label="Name" variant="outlined" class="mb-2" />
          <div class="d-flex ga-2 mb-4">
            <v-chip color="primary" variant="tonal">Active</v-chip>
            <v-chip variant="tonal">New</v-chip>
          </div>
          <div class="d-flex ga-2">
            <v-btn color="primary" variant="flat">Save</v-btn>
            <v-btn variant="text">Cancel</v-btn>
          </div>
        </v-sheet>
      </AppTheme>
    </div>
  </div>
</template>

<style scoped>
.apps-look {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 24px;
}
@media (max-width: 760px) {
  .apps-look {
    grid-template-columns: 1fr;
  }
}
.apps-look__code {
  max-width: 180px;
}
</style>
