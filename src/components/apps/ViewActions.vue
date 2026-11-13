<script setup>
import { computed, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { actorName, whenText as when } from "./appRuntime.js";
import { appsApi, errorText } from "./appsApi.js";
import { askInChat } from "./askInChat.js";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

// What people do with a view (D-55): restore a version, ask its bot, retire it (D-62). Everyone in the
// home sees every view and may do these (D-66); no bot tool does any of them but asking. `loaded` is
// the view as its route gives it.
const props = defineProps({
  loaded: { type: Object, required: true },
  // In the viewer: a link to the full page. The full page has no need of one.
  fullPageLink: { type: Boolean, default: true }
});
const emit = defineEmits(["restored", "retired"]);

const router = useRouter();
const paths = usePaths();
const app = computed(() => props.loaded.app);
const problem = reactive({ open: false, text: "" });
const showProblem = (error, fallback) => Object.assign(problem, { open: true, text: errorText(error, fallback) });

const versions = ref(null);
// Whether older versions than those listed follow (the list comes a page at a time).
const moreVersions = ref(false);
async function openVersions() {
  try {
    const page = await appsApi.versions(app.value.slug);
    versions.value = page.versions;
    moreVersions.value = page.more;
  } catch (error) {
    showProblem(error, "The versions couldn't load.");
  }
}
async function olderVersions() {
  try {
    const page = await appsApi.versions(app.value.slug, versions.value.at(-1)?.id);
    versions.value = [...versions.value, ...page.versions];
    moreVersions.value = page.more;
  } catch (error) {
    showProblem(error, "The versions couldn't load.");
  }
}
async function restore(version) {
  try {
    await appsApi.restore(app.value.slug, version.id);
    versions.value = null;
    emit("restored");
  } catch (error) {
    showProblem(error, "That version couldn't be restored.");
  }
}

function ask() {
  const { name, slug } = app.value;
  askInChat(router, { chat: paths.page("/"), botId: props.loaded.bot.id, line: `About the view "${name}" (${slug}): ` });
}

const confirmRetire = ref(false);
async function retire() {
  confirmRetire.value = false;
  try {
    await appsApi.retireView(app.value.slug);
    window.dispatchEvent(new CustomEvent("mercbot:apps-changed"));
    emit("retired");
  } catch (error) {
    showProblem(error, "The view couldn't be retired.");
  }
}
</script>

<template>
  <div class="d-flex align-center flex-wrap ga-1 view-actions">
    <v-btn prepend-icon="$history" variant="text" size="small" @click="openVersions">Versions</v-btn>
    <v-btn v-if="loaded.bot" prepend-icon="$smartToy" variant="text" size="small" @click="ask">Ask {{ loaded.bot.name }}</v-btn>
    <v-btn v-if="fullPageLink" :to="paths.page(`/apps/${app.slug}`)" prepend-icon="$openInNew" variant="text" size="small">Open full page</v-btn>
    <v-btn icon="$archive" variant="text" size="small" aria-label="Retire this view" @click="confirmRetire = true" />

    <v-dialog :model-value="Boolean(versions)" max-width="480" @update:model-value="versions = null">
      <v-card v-if="versions" class="pa-4">
        <div class="text-h6 mb-2">Versions of {{ app.name }}</div>
        <v-list density="compact">
          <v-list-item v-for="version in versions" :key="version.id" :title="`Version ${version.number}${version.live ? ' (showing)' : ''}`" :subtitle="`${version.summary || ''} · ${actorName(version.by)} · ${when(version.publishedAt)}`">
            <template #append>
              <v-btn v-if="!version.live" variant="text" size="small" @click="restore(version)">Restore</v-btn>
            </template>
          </v-list-item>
        </v-list>
        <v-btn v-if="moreVersions" variant="text" size="small" @click="olderVersions">Older versions</v-btn>
      </v-card>
    </v-dialog>

    <v-dialog v-model="confirmRetire" max-width="420">
      <v-card class="pa-4">
        <div class="text-h6 mb-2">Retire {{ app.name }}?</div>
        <div class="text-body-2 mb-4">It leaves the Apps area, search and the pins, and apps can't use it. Nothing is deleted: it and its versions are kept.</div>
        <div class="d-flex justify-end ga-2">
          <v-btn variant="text" @click="confirmRetire = false">Keep it</v-btn>
          <v-btn color="primary" variant="flat" @click="retire">Retire</v-btn>
        </div>
      </v-card>
    </v-dialog>
    <v-snackbar v-model="problem.open" color="error" timeout="5000">{{ problem.text }}</v-snackbar>
  </div>
</template>

<style scoped>
.view-actions :deep(.v-btn) {
  font-size: 13px;
}
</style>
