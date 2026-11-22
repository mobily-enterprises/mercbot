<script setup>
import { computed, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { fileKind, formatSize } from "../mercbot/filesApi.js";
import { nameOf, pickerAction, pickerLabel, pickerRefusal, useFolderListing } from "./filePlaces.js";

// The one place picker (D-47): a place, then a folder in it, for Copy to… and Move to… ("Copy here", "Move here"), or,
// for Add from files in a chat's message box, files in any place ("Add 2 files"). It only chooses; whoever opened it
// copies or moves (useFileTransfer).
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({
  // "copy", "move" or "add".
  mode: { type: String, required: true },
  // The places, as filePlaces.js orders them; null while they load.
  places: { type: Array, default: null },
  // The place it opens at (a key), else the first one offered.
  start: { type: String, default: "" },
  // What's being copied or moved, from which place: its path and the place's key.
  path: { type: String, default: "" },
  from: { type: String, default: "" },
  // A place not offered (Add from files leaves out the chat it adds to).
  exclude: { type: String, default: "" }
});
const emit = defineEmits(["choose"]);

const display = useDisplay();
const { at, current, failure, crumbs, go, reload } = useFolderListing();
const placeKey = ref("");
// Files chosen to add, from any place: { item, path, size, key }.
const chosen = ref([]);

const adding = computed(() => props.mode === "add");
const offered = computed(() => (props.places || []).filter((item) => item.key !== props.exclude));
const place = computed(() => offered.value.find((item) => item.key === placeKey.value) || null);
const heading = computed(() => {
  if (adding.value) return "Add from files";
  return `${props.mode === "copy" ? "Copy" : "Move"} ${nameOf(props.path)} to…`;
});
const folders = computed(() => (current.value?.entries || []).filter((entry) => entry.folder));
const files = computed(() => (adding.value ? (current.value?.entries || []).filter((entry) => !entry.folder) : []));

const refusal = computed(() => (adding.value || !place.value || !at.value
  ? ""
  : pickerRefusal({ mode: props.mode, item: place.value, folder: at.value.folder, from: props.from, path: props.path })));
const actionLabel = computed(() => pickerAction(props.mode, chosen.value.length));
const ready = computed(() => (adding.value ? chosen.value.length > 0 : Boolean(current.value) && !refusal.value));

function choosePlace(key) {
  placeKey.value = key;
  if (place.value) go(place.value);
}

// Each time it opens: at its start place (or the first offered) and with nothing chosen.
watch(() => [open.value, Boolean(props.places)], ([isOpen, loaded]) => {
  if (!isOpen || !loaded) return;
  chosen.value = [];
  const first = offered.value.find((item) => item.key === props.start) || offered.value[0];
  if (first) choosePlace(first.key);
}, { immediate: true });

const fileKey = (entry) => `${placeKey.value} ${entry.path}`;
const isChosen = (entry) => chosen.value.some((file) => file.key === fileKey(entry));
function toggle(entry) {
  chosen.value = isChosen(entry)
    ? chosen.value.filter((file) => file.key !== fileKey(entry))
    : [...chosen.value, { key: fileKey(entry), item: place.value, path: entry.path, size: entry.size }];
}

function choose() {
  emit("choose", adding.value ? { files: chosen.value } : { to: place.value, folder: at.value.folder });
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" :max-width="display.xs.value ? undefined : 520" :fullscreen="display.xs.value">
    <v-card :title="heading" class="mb-picker">
      <v-card-text class="mb-picker__body">
        <div v-if="!places" class="mb-picker__skeleton" aria-hidden="true" />
        <template v-else>
          <!-- readable-check: allow selection-field - data: the places the browser already read, by key -->
          <v-select
            :model-value="placeKey"
            :items="offered"
            :item-title="pickerLabel"
            item-value="key"
            label="Place"
            variant="outlined"
            density="comfortable"
            hide-details
            @update:model-value="choosePlace"
          />
          <nav class="mb-picker__crumbs" aria-label="Folders">
            <template v-for="(crumb, index) in crumbs" :key="crumb.path">
              <v-icon v-if="index" icon="$chevronRight" size="14" class="mb-picker__sep" />
              <button type="button" class="mb-picker__crumb" :class="{ 'mb-picker__crumb--here': crumb.path === at?.folder }" @click="go(place, crumb.path)">{{ crumb.label }}</button>
            </template>
          </nav>
          <p v-if="failure" class="mb-picker__note" role="alert">
            {{ failure.message || "The folder couldn't load." }}
            <v-btn size="small" variant="text" @click="reload">Try again</v-btn>
          </p>
          <div v-else-if="!current" class="mb-picker__skeleton" aria-hidden="true" />
          <p v-else-if="!folders.length && !files.length" class="mb-picker__note">{{ adding ? "No files here." : "No folders in here." }}</p>
          <ul v-else class="mb-picker__list">
            <li v-for="entry in folders" :key="entry.path">
              <button type="button" class="mb-picker__row" @click="go(place, entry.path)">
                <v-icon icon="$folder" size="18" class="mb-picker__icon" />
                <span class="mb-picker__name">{{ nameOf(entry.path) }}</span>
                <v-icon icon="$chevronRight" size="18" class="mb-picker__icon" />
              </button>
            </li>
            <li v-for="entry in files" :key="entry.path">
              <label class="mb-picker__row">
                <v-checkbox-btn :model-value="isChosen(entry)" density="compact" :aria-label="`Add ${nameOf(entry.path)}`" @update:model-value="toggle(entry)" />
                <v-icon :icon="fileKind(entry.path).icon" size="18" class="mb-picker__icon" />
                <span class="mb-picker__name">{{ nameOf(entry.path) }}</span>
                <span class="mb-picker__meta">{{ formatSize(entry.size) }}</span>
              </label>
            </li>
          </ul>
          <p v-if="refusal" class="mb-picker__note">{{ refusal }}</p>
        </template>
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn variant="text" @click="open = false">Cancel</v-btn>
        <v-btn color="primary" variant="flat" :disabled="!ready" @click="choose">{{ actionLabel }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.mb-picker__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mb-picker__crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
}

.mb-picker__crumb {
  padding: 2px 4px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: rgb(var(--v-theme-on-surface-variant));
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.mb-picker__crumb--here {
  color: rgb(var(--v-theme-on-surface));
}

.mb-picker__crumb:hover,
.mb-picker__crumb:focus-visible,
.mb-picker__row:hover,
.mb-picker__row:focus-visible {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.mb-picker__sep,
.mb-picker__icon {
  flex-shrink: 0;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-picker__list {
  max-height: 320px;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.mb-picker__row {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.mb-picker__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-picker__meta,
.mb-picker__note {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-picker__note {
  margin: 0;
  padding: 4px 8px;
}

.mb-picker__skeleton {
  height: 160px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
</style>
