<script setup>
import { computed, ref, watch } from "vue";
import TemplateAvatar from "@/components/templates/TemplateAvatar.vue";
import TemplateContents from "@/components/templates/TemplateContents.vue";
import TemplateTested from "@/components/templates/TemplateTested.vue";
import { templatesApi } from "@/components/templates/templatesApi.js";
import { appsApi } from "@/components/apps/appsApi.js";
import { botsApi } from "./botsApi.js";

// Before a bot is added from a template or a shared link (D-43): the whole of it, opened out
// (instructions, every skill's steps, routines, apps), and nothing added until Add bot. Owners
// and admins may also set up the app it's made to work with, as a draft to review.
const props = defineProps({ slug: { type: String, default: "" } });
const emit = defineEmits(["added", "close"]);

const template = ref(null);
const problem = ref("");
const adding = ref(false);
const appChoice = ref(null);
const withApp = ref(true);

const open = computed({
  get: () => Boolean(props.slug),
  set: (value) => { if (!value) emit("close"); }
});

watch(() => props.slug, async (slug) => {
  template.value = null;
  problem.value = "";
  appChoice.value = null;
  if (!slug) return;
  try {
    template.value = await templatesApi.template(slug);
  } catch (error) {
    problem.value = error?.status === 404 ? "There's no bot at that link. It may have been removed." : "This bot couldn't be loaded. Try again in a moment.";
    return;
  }
  if (template.value.appTemplate) {
    const { templates = [], canManage } = await appsApi.templates().catch(() => ({}));
    const app = templates.find((entry) => entry.key === template.value.appTemplate);
    if (app) appChoice.value = { ...app, canManage: Boolean(canManage) };
  }
}, { immediate: true });

const updated = computed(() => (template.value?.updatedAt ? new Date(template.value.updatedAt).toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) : ""));
const team = computed(() => Boolean(template.value?.team));

async function add() {
  if (adding.value) return;
  adding.value = true;
  problem.value = "";
  try {
    const { bot } = await botsApi.fromTemplate(props.slug);
    let appNote = "";
    if (appChoice.value?.canManage && withApp.value) {
      appNote = await appsApi.installTemplate(appChoice.value.key, false)
        .then(() => `The ${appChoice.value.name} app is set up as a draft in Apps for you to review and publish.`)
        .catch(() => `The ${appChoice.value.name} app couldn't be set up; you can add it from Apps → Templates.`);
    }
    emit("added", { bot, appNote });
  } catch {
    problem.value = "The bot couldn't be added. Try again.";
  } finally {
    adding.value = false;
  }
}
</script>

<template>
  <v-dialog v-model="open" width="640" scrollable>
    <div class="mb-tpreview" role="dialog" aria-label="Add a bot">
      <button type="button" class="mb-tpreview__close" aria-label="Close" @click="emit('close')"><v-icon icon="$close" size="18" /></button>
      <p v-if="!template" class="mb-tpreview__note">{{ problem || "Loading…" }}</p>
      <template v-else>
        <div class="mb-tpreview__scroll">
          <header class="mb-tpreview__head">
            <TemplateAvatar :template="template" :size="64" />
            <div>
              <h2 class="mb-tpreview__name">{{ template.name }}</h2>
              <p class="mb-tpreview__by">by {{ template.creator }}<template v-if="updated"> · last updated {{ updated }}</template></p>
              <!-- Only the Mercbot team's templates are checked end to end (D-43, D-79). -->
              <TemplateTested v-if="team" :template="template" class="mb-tpreview__tested" />
            </div>
          </header>
          <p class="mb-tpreview__description">{{ template.description }}</p>
          <p class="mb-tpreview__fine">
            {{ team ? "Made by the Mercbot team." : `Made by ${template.creator}, not by Mercbot.` }}
            It may act on your behalf with the apps you connect, and asks before sending anything. Here's everything it's told to do; read it before adding it.
          </p>
          <TemplateContents :template="template" all />
          <label v-if="appChoice?.canManage" class="mb-tpreview__app">
            <input v-model="withApp" type="checkbox">
            Also set up the {{ appChoice.name }} app it works with, as a draft for you to review
          </label>
          <p v-else-if="appChoice" class="mb-tpreview__fine">It works with a {{ appChoice.name }} app, which an owner or admin of this home can add from Apps → Templates.</p>
        </div>
        <footer class="mb-tpreview__foot">
          <span v-if="problem" class="mb-tpreview__problem" role="alert">{{ problem }}</span>
          <button type="button" class="mb-set-pill" @click="emit('close')">Cancel</button>
          <button type="button" class="mb-set-pill mb-set-pill--dark" :disabled="adding" @click="add">{{ adding ? "Adding…" : "Add bot" }}</button>
        </footer>
      </template>
    </div>
  </v-dialog>
</template>

<style scoped>
.mb-tpreview {
  position: relative;
  display: flex;
  flex-direction: column;
  max-height: 86vh;
  border-radius: 20px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-tpreview__close {
  position: absolute;
  top: 14px;
  right: 14px;
  z-index: 1;
  display: inline-flex;
  padding: 6px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.mb-tpreview__scroll {
  overflow-y: auto;
  padding: 24px 24px 8px;
}

.mb-tpreview__head {
  display: flex;
  align-items: center;
  gap: 16px;
}

.mb-tpreview__name {
  margin: 0;
  font-size: 20px;
  font-weight: 700;
}

.mb-tpreview__by,
.mb-tpreview__fine,
.mb-tpreview__note {
  margin: 2px 0 0;
  font-size: 13px;
  line-height: 19px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tpreview__note {
  padding: 32px 24px;
}

.mb-tpreview__tested {
  margin-top: 6px;
}

.mb-tpreview__description {
  margin: 14px 0 6px;
  font-size: 15px;
  line-height: 22px;
}

.mb-tpreview__fine {
  margin-bottom: 14px;
}

.mb-tpreview__app {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0 12px;
  font-size: 14px;
}

.mb-tpreview__foot {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 24px 18px;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
}

.mb-tpreview__problem {
  margin-right: auto;
  font-size: 13px;
  color: rgb(var(--v-theme-error));
}
</style>
