<script setup>
import { computed, onMounted, ref } from "vue";
import { errorText } from "@/components/apps/appsApi.js";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import { websitesApi } from "./websitesApi.js";

// A page's place on the home's own website (D-84), in its Share: where it's published, with Publish (again) and
// Unpublish. What goes there is the page on its own, without its scripts. The first publish to a new website
// is confirmed first, as it puts the page on the internet; then Mercbot reads the page back at its address and says
// plainly when it doesn't answer there. Owners and admins publish; anyone in the home unpublishes (the server decides).
const props = defineProps({
  botId: { type: String, required: true },
  path: { type: String, required: true }
});
const emit = defineEmits(["copied"]);
const state = ref(null);
const busy = ref(false);
const problem = ref("");
const warning = ref("");
const confirming = ref(false);

const website = computed(() => state.value?.website || null);
const publication = computed(() => state.value?.publication || null);
const canPublish = computed(() => state.value?.canPublish === true);
const when = computed(() => (publication.value ? new Date(publication.value.publishedAt).toLocaleString() : ""));

onMounted(async () => {
  try {
    state.value = await websitesApi.page(props.botId, props.path);
  } catch (error) {
    problem.value = errorText(error, "Where this page is published couldn't be read.");
  }
});

async function publish(confirmed = false) {
  if (state.value?.confirmFirst && !confirmed) {
    confirming.value = true;
    return;
  }
  busy.value = true;
  problem.value = "";
  warning.value = "";
  try {
    const answer = await websitesApi.publish(props.botId, props.path, confirmed);
    state.value = answer;
    if (answer.check?.ok === false) warning.value = answer.check.message;
    else emit("copied", "Published to your website");
  } catch (error) {
    if (error?.status === 403) state.value = { ...state.value, canPublish: false };
    problem.value = errorText(error, "That didn't work. Try again.");
  }
  busy.value = false;
}

async function unpublish() {
  busy.value = true;
  problem.value = "";
  warning.value = "";
  try {
    state.value = await websitesApi.unpublish(props.botId, props.path);
    emit("copied", "Taken off your website");
  } catch (error) {
    problem.value = errorText(error, "That didn't work. Try again.");
  }
  busy.value = false;
}

async function copyAddress() {
  try {
    await navigator.clipboard.writeText(publication.value.url);
    emit("copied", "Address copied");
  } catch {
    problem.value = "The address couldn't be copied. Select it and copy it instead.";
  }
}
</script>

<template>
  <div v-if="state || problem" class="mb-page-site">
    <div class="mb-page-site__row">
      <span class="mb-page-site__glyph"><v-icon icon="$language" size="18" /></span>
      <span class="mb-page-site__text">
        <span class="mb-page-site__name">Your website</span>
        <span class="mb-page-site__note">
          {{ !website ? "Not set up" : publication ? `Published ${when}, without its scripts` : "Not published" }}
        </span>
      </span>
      <button v-if="website && !publication && canPublish" type="button" class="mb-page-site__button" :disabled="busy" @click="publish()">
        {{ busy ? "Publishing…" : "Publish" }}
      </button>
    </div>
    <p v-if="state && !website" class="mb-page-site__aside">Set one up in Settings → Website to publish pages there.</p>
    <p v-else-if="state && !canPublish && !publication" class="mb-page-site__aside">Only the home's owners and admins can publish to it.</p>
    <div v-if="publication" class="mb-page-site__place">
      <input class="mb-page-site__address" :value="publication.url" readonly aria-label="Address on your website" @focus="$event.target.select()">
      <div class="mb-page-site__actions">
        <button type="button" class="mb-page-site__button" @click="copyAddress"><v-icon icon="$contentCopy" size="16" /> Copy</button>
        <a class="mb-page-site__button" :href="publication.url" target="_blank" rel="noopener noreferrer"><v-icon icon="$openInNew" size="16" /> Open</a>
        <button v-if="canPublish" type="button" class="mb-page-site__button" :disabled="busy" @click="publish()">Publish again</button>
        <button type="button" class="mb-page-site__button" :disabled="busy" @click="unpublish">Unpublish</button>
      </div>
    </div>
    <p v-if="warning" class="mb-page-site__problem" role="alert">{{ warning }}</p>
    <p v-if="problem" class="mb-page-site__problem" role="alert">{{ problem }}</p>
    <MercbotConfirmDialog
      v-model="confirming"
      title="Publish to your website?"
      :text="`Anyone on the internet will be able to open this page at ${website?.baseUrl || 'your website'}. You can unpublish it later.`"
      confirm-label="Publish"
      @confirm="publish(true)"
    />
  </div>
</template>

<style scoped>
.mb-page-site {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mb-page-site__row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 4px 0;
}

.mb-page-site__glyph {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-page-site__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  font-size: 13px;
}

.mb-page-site__name {
  font-size: 14px;
  font-weight: 500;
}

.mb-page-site__note {
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}

.mb-page-site__aside {
  margin: -6px 0 0 44px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
}

.mb-page-site__place {
  margin-left: 44px;
}

.mb-page-site__address {
  width: 100%;
  padding: 6px 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface-container));
  color: inherit;
  font-size: 12px;
}

.mb-page-site__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 8px;
}

.mb-page-site__button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 17px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-decoration: none;
  cursor: pointer;
}

.mb-page-site__problem {
  margin: 0;
  color: rgb(var(--v-theme-error));
  font-size: 13px;
}
</style>
