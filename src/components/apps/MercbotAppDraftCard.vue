<script setup>
import { computed, ref } from "vue";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { appsApi, errorText } from "./appsApi.js";

// The Builder saved an app draft (D-35): the person previews it on practice data (D-71) and
// decides. Publish acts as the person who clicks it, also in a shared room (D-36).
const props = defineProps({ message: { type: Object, required: true } });
const paths = usePaths();
const body = computed(() => props.message.body || {});
const state = ref("draft");
const published = ref(null);
const problem = ref("");

async function publish() {
  state.value = "publishing";
  problem.value = "";
  try {
    published.value = (await appsApi.publish(body.value.slug)).number;
    state.value = "published";
  } catch (error) {
    const message = errorText(error, "");
    if (/no draft/iu.test(message)) state.value = "gone";
    else {
      problem.value = message || "Publishing didn't work.";
      state.value = "draft";
    }
  }
}
</script>

<template>
  <section class="mb-app-draft" :aria-label="`Draft of ${body.name}`">
    <div class="text-caption text-medium-emphasis">App draft · {{ body.name }}</div>
    <div class="text-body-1 my-1">{{ body.summary }}</div>
    <div v-if="state === 'published'" class="text-body-2">Published as version {{ published }}.</div>
    <div v-else-if="state === 'gone'" class="text-body-2 text-medium-emphasis">This draft has been published or replaced.</div>
    <template v-else>
      <div class="text-body-2 text-medium-emphasis">Try it in Preview on practice data, then press Publish to start using it.</div>
      <div class="d-flex flex-wrap ga-2 mt-2">
        <v-btn :to="paths.page(`/apps/${body.slug}?version=draft`)" variant="tonal" size="small">Preview</v-btn>
        <v-btn color="primary" variant="flat" size="small" :disabled="state === 'publishing'" @click="publish">{{ state === "publishing" ? "Publishing…" : "Publish" }}</v-btn>
      </div>
    </template>
    <div v-if="problem" class="text-body-2 text-error mt-1">{{ problem }}</div>
  </section>
</template>

<style scoped>
.mb-app-draft {
  max-width: 420px;
  padding: 12px 16px;
  border: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  border-radius: 16px;
}
</style>
