<script setup>
import { ref, watch } from "vue";
import { errorText } from "@/components/apps/appsApi.js";
import { whenText } from "@/components/apps/appRuntime.js";
import { pagesApi } from "./filesApi.js";

// A page's versions (D-63, D-74), as views have them: every save, change and restore is kept, newest
// first, and Restore brings an earlier one back as the newest. Its link, if it has one, stays the same.
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({
  botId: { type: String, required: true },
  path: { type: String, required: true },
  title: { type: String, required: true },
  botName: { type: String, default: "The bot" },
  me: { type: String, default: "" }
});
const emit = defineEmits(["restored"]);

const versions = ref(null);
const problem = ref("");

function label(version) {
  if (version.kind === "restore") return version.userId && version.userId === props.me ? "Restored by you" : "Restored";
  return version.kind === "edit" ? `Changed by ${props.botName}` : `Saved by ${props.botName}`;
}

async function load() {
  problem.value = "";
  try {
    versions.value = (await pagesApi.versions(props.botId, props.path)).versions;
  } catch (error) {
    versions.value = [];
    problem.value = errorText(error, "The versions couldn't load.");
  }
}
watch(open, (now) => {
  if (now) load();
}, { immediate: true });

async function restore(version) {
  problem.value = "";
  try {
    versions.value = (await pagesApi.restore(props.botId, props.path, version.id)).versions;
    emit("restored");
  } catch (error) {
    problem.value = errorText(error, "That version couldn't be restored.");
  }
}
</script>

<template>
  <v-dialog v-model="open" max-width="480">
    <v-card class="pa-4">
      <div class="text-h6 mb-2">Versions of {{ title }}</div>
      <v-progress-linear v-if="!versions" indeterminate />
      <p v-else-if="!versions.length && !problem" class="text-body-2">This page has no saved versions yet.</p>
      <v-list v-else density="compact">
        <v-list-item
          v-for="version in versions"
          :key="version.id"
          :title="`${label(version)}${version.current ? ' (showing)' : ''}`"
          :subtitle="whenText(version.at)"
        >
          <template #append>
            <v-btn v-if="!version.current" variant="text" size="small" @click="restore(version)">Restore</v-btn>
          </template>
        </v-list-item>
      </v-list>
      <p v-if="problem" class="text-body-2 text-error mt-2" role="alert">{{ problem }}</p>
      <div class="d-flex justify-end mt-2">
        <v-btn variant="text" size="small" @click="open = false">Close</v-btn>
      </div>
    </v-card>
  </v-dialog>
</template>
