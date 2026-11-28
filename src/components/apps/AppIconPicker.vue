<script setup>
import { computed, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { useRouter } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { askBuilder } from "./askInChat.js";
import { errorText } from "./appsApi.js";
import { appGlyph } from "./appRuntime.js";
import AppTile from "./AppTile.vue";
import { iconGroups, iconWords, lookToSave, startingLook } from "./appIconChoices.js";
import { APP_COLOURS } from "@/theme/palettes.js";

// Choosing an app's picture and colour (D-141): the pictures by group with a search, the tile colours, and a preview.
// It answers the choice with "save"; the caller sends it and closes the dialog. Ask the Builder to draw one opens the
// app's chat with the Builder, which draws a picture of the app's own and puts it on the tile.
const props = defineProps({
  open: { type: Boolean, required: true },
  name: { type: String, required: true },
  slug: { type: String, required: true },
  icon: { type: String, required: true },
  color: { type: String, required: true },
  // A bot's picture on the tile, shown until a set picture is chosen.
  picture: { type: String, default: null },
  saving: { type: Boolean, required: true }
});
const emit = defineEmits(["update:open", "save", "failed"]);
const router = useRouter();
const paths = usePaths();
const { xs } = useDisplay();

const search = ref("");
const chosen = ref(startingLook(props));
watch(() => props.open, (open) => {
  if (open) {
    search.value = "";
    chosen.value = startingLook(props);
  }
});
const groups = computed(() => iconGroups(search.value));
const close = () => emit("update:open", false);
async function draw() {
  const line = `Draw a picture for the app "${props.name}" (${props.slug}) and put it on its tile: `;
  try {
    await askBuilder(router, { chat: paths.page("/"), appSlug: props.slug, line });
    close();
  } catch (error) {
    emit("failed", errorText(error, "The app's chat with the Builder couldn't open. Try again."));
  }
}
</script>

<template>
  <v-dialog :model-value="open" :fullscreen="xs" max-width="640" scrollable @update:model-value="emit('update:open', $event)">
    <v-card class="app-icon-picker">
      <v-card-title class="d-flex align-center ga-3 pa-4">
        <AppTile :icon="chosen.icon || icon" :color="chosen.color" :picture="chosen.icon ? null : picture" :size="48" />
        <span class="app-icon-picker__name">{{ name }}</span>
      </v-card-title>
      <v-card-text class="pt-0">
        <div class="text-body-2 text-on-surface-variant mb-2">Colour</div>
        <div class="d-flex flex-wrap ga-2 mb-4" role="radiogroup" aria-label="Colour">
          <button
            v-for="colour in APP_COLOURS"
            :key="colour.value"
            type="button"
            role="radio"
            :aria-checked="chosen.color.toLowerCase() === colour.value.toLowerCase()"
            :aria-label="colour.name"
            :title="colour.name"
            class="app-icon-picker__colour"
            :class="{ 'app-icon-picker__colour--on': chosen.color.toLowerCase() === colour.value.toLowerCase() }"
            :style="{ background: colour.value }"
            @click="chosen = { ...chosen, color: colour.value }"
          />
        </div>
        <v-text-field
          v-model="search"
          prepend-inner-icon="$search"
          placeholder="Search pictures"
          aria-label="Search pictures"
          variant="outlined"
          density="compact"
          hide-details
          clearable
          class="mb-3"
        />
        <div v-if="!groups.length" class="text-body-2 text-on-surface-variant">No picture matches.</div>
        <section v-for="entry in groups" :key="entry.group" class="mb-3">
          <div class="text-body-2 text-on-surface-variant mb-1">{{ entry.group }}</div>
          <div class="d-flex flex-wrap ga-1">
            <button
              v-for="glyph in entry.names"
              :key="glyph"
              type="button"
              :aria-label="iconWords(glyph)"
              :aria-pressed="chosen.icon === glyph"
              :title="iconWords(glyph)"
              class="app-icon-picker__icon"
              :class="{ 'app-icon-picker__icon--on': chosen.icon === glyph }"
              @click="chosen = { ...chosen, icon: glyph }"
            >
              <v-avatar :color="chosen.color" size="36" rounded="lg"><v-icon :icon="appGlyph(glyph)" color="white" size="22" /></v-avatar>
            </button>
          </div>
        </section>
      </v-card-text>
      <v-card-actions class="pa-4 pt-2">
        <v-btn variant="text" prepend-icon="$smartToy" :disabled="saving" @click="draw">Ask the Builder to draw one</v-btn>
        <v-spacer />
        <v-btn variant="text" :disabled="saving" @click="close">Cancel</v-btn>
        <v-btn variant="flat" color="primary" :disabled="saving" @click="emit('save', lookToSave(chosen))">{{ saving ? "Saving…" : "Save" }}</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.app-icon-picker__name {
  font-size: 15px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.app-icon-picker__colour {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 0;
  cursor: pointer;
}
.app-icon-picker__icon {
  padding: 2px;
  border: 2px solid transparent;
  border-radius: 10px;
  background: none;
  cursor: pointer;
}
.app-icon-picker__colour--on,
.app-icon-picker__icon--on {
  outline: 2px solid rgb(var(--v-theme-on-surface));
  outline-offset: 2px;
}
.app-icon-picker__colour:focus-visible,
.app-icon-picker__icon:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
</style>
