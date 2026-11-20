<script setup>
import { computed, ref, watch } from "vue";
import { templatesApi } from "../templates/templatesApi.js";
import { appsApi } from "../apps/appsApi.js";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotTemplateTag from "./MercbotTemplateTag.vue";
import { botsApi } from "./botsApi.js";
import { addLabel, appsFor, botsToAdd } from "./teamChoice.js";

// Add a team (D-105), New bot's step for a few bots at once: first Mercbot's teams, each a situation with its line and
// its bots' faces, then the team chosen, its bots each with its name, look, tag and line, all ticked. A bot the home
// already has on the same template says "Already in this home" and isn't added. An owner or admin also sets up the app a
// bot works with, as New bot does. Add N bots asks the shell to make the ones ticked (useNewBot.js addTeam).
const props = defineProps({
  busy: { type: Boolean, default: false },
  error: { type: String, default: "" }
});
// The team on screen, or "" for the list of teams.
const teamId = defineModel("team", { type: String, default: "" });
const emit = defineEmits(["add", "back"]);

const gallery = ref(null);
const listFailed = ref(false);
const team = ref(null);
const teamFailed = ref(false);
const unticked = ref(new Set());
// The apps a team's bots work with, by key, when the person may set them up (an owner or admin), and those left out.
const apps = ref(new Map());
const withoutApp = ref(new Set());

const looks = computed(() => new Map((gallery.value?.templates || []).map((template) => [template.slug, template])));
const facesOf = (entry) => entry.templates.map((slug) => looks.value.get(slug)).filter(Boolean);
const adding = computed(() => botsToAdd(team.value, unticked.value));
const tagOf = (bot) => ({ template: { tag: bot.tag, source: "library", description: bot.description } });
const appOf = (bot) => (bot.appTemplate ? apps.value.get(bot.appTemplate) || null : null);

async function loadTeams() {
  listFailed.value = false;
  try {
    gallery.value = await templatesApi.gallery();
  } catch {
    listFailed.value = true;
  }
}

async function loadTeam(id) {
  team.value = null;
  teamFailed.value = false;
  unticked.value = new Set();
  withoutApp.value = new Set();
  try {
    const read = await botsApi.team(id);
    if (teamId.value !== id) return;
    team.value = read;
  } catch {
    if (teamId.value === id) teamFailed.value = true;
    return;
  }
  if (!team.value.bots.some((bot) => bot.appTemplate)) return;
  const { templates = [], canManage } = await appsApi.templates().catch(() => ({}));
  apps.value = canManage ? new Map(templates.map((app) => [app.key, app])) : new Map();
}

watch(teamId, (id) => {
  if (id) loadTeam(id);
  else if (!gallery.value) loadTeams();
}, { immediate: true });

/** The set with slug taken out if it was in, added if it wasn't, as a new Set, so what reads it updates. */
function flipped(set, slug) {
  const next = new Set(set);
  if (!next.delete(slug)) next.add(slug);
  return next;
}

function tick(slug) {
  unticked.value = flipped(unticked.value, slug);
}

function tickApp(slug) {
  withoutApp.value = flipped(withoutApp.value, slug);
}

function back() {
  if (props.busy) return;
  if (teamId.value) teamId.value = "";
  else emit("back");
}

/** Add N bots: the team's ticked bots, and the apps to set up for them, each once. */
function add() {
  if (!adding.value.length || props.busy) return;
  emit("add", {
    teamId: team.value.id,
    name: team.value.name,
    templates: adding.value.map((bot) => bot.slug),
    apps: appsFor(adding.value, apps.value, withoutApp.value)
  });
}

defineExpose({ back });
</script>

<template>
  <div class="mb-ctemp__scroll">
    <button type="button" class="mb-ctemp__step-link" :disabled="busy" @click="back">
      <v-icon icon="$chevronLeft" size="16" /> {{ teamId ? "All teams" : "All templates" }}
    </button>

    <template v-if="!teamId">
      <p class="mb-team__intro">A team is a few bots for one situation, made together in a section of your sidebar.</p>
      <div v-if="listFailed" class="mb-ctemp__state" role="alert">
        <p>The teams couldn't be loaded.</p>
        <button type="button" class="mb-set-pill" @click="loadTeams">Try again</button>
      </div>
      <div v-else-if="!gallery" class="mb-ctemp__state" role="status" aria-label="Loading the teams" />
      <div v-else class="mb-team__list">
        <button v-for="entry in gallery.teams" :key="entry.id" type="button" class="mb-team__choice" @click="teamId = entry.id">
          <span class="mb-team__text">
            <strong>{{ entry.name }}</strong>
            <span class="mb-team__line">{{ entry.description }}</span>
            <span class="mb-team__faces" aria-hidden="true">
              <MercbotAvatar v-for="face in facesOf(entry)" :key="face.slug" :bot="{ id: `face-${face.slug}`, name: face.name, color: face.color, shape: face.shape }" :size="22" still />
              <span class="mb-team__count">{{ entry.templates.length }} bots</span>
            </span>
          </span>
          <v-icon icon="$chevronRight" size="18" />
        </button>
      </div>
    </template>

    <template v-else>
      <div v-if="teamFailed" class="mb-ctemp__state" role="alert">
        <p>That team couldn't be loaded.</p>
        <button type="button" class="mb-set-pill" @click="loadTeam(teamId)">Try again</button>
      </div>
      <div v-else-if="!team" class="mb-ctemp__state" role="status" aria-label="Loading the team" />
      <template v-else>
        <h3 class="mb-team__name">{{ team.name }}</h3>
        <p class="mb-team__intro">{{ team.description }}</p>
        <ul class="mb-team__bots" :aria-label="`${team.name}'s bots`">
          <li v-for="bot in team.bots" :key="bot.slug" class="mb-team__bot" :class="{ 'mb-team__bot--in': bot.inHome }">
            <label class="mb-team__pick">
              <input
                type="checkbox"
                :checked="!bot.inHome && !unticked.has(bot.slug)"
                :disabled="bot.inHome || busy"
                :aria-label="bot.inHome ? `${bot.name}, already in this home` : `Add ${bot.name}`"
                @change="tick(bot.slug)"
              >
              <MercbotAvatar :bot="{ id: `team-${bot.slug}`, name: bot.name, color: bot.color, shape: bot.shape }" :size="40" still />
              <span class="mb-team__text">
                <span class="mb-team__head">
                  <strong>{{ bot.name }}</strong>
                  <MercbotTemplateTag :bot="tagOf(bot)" :tooltip="false" />
                  <span v-if="bot.inHome" class="mb-team__in">Already in this home</span>
                </span>
                <span class="mb-team__line">{{ bot.description }}</span>
              </span>
            </label>
            <label v-if="appOf(bot) && !bot.inHome && !unticked.has(bot.slug)" class="mb-team__app">
              <input type="checkbox" :checked="!withoutApp.has(bot.slug)" :disabled="busy" @change="tickApp(bot.slug)">
              Also set up the {{ appOf(bot).name }} app it works with, as a draft for you to review
            </label>
          </li>
        </ul>
        <p class="mb-ctemp__note">
          They go in a section called {{ team.name }}, shared as this home's new bots are. Each greets you when you open it and does
          nothing until you answer.
        </p>
      </template>
    </template>
  </div>
  <p v-if="error" class="mb-ctemp__error" role="alert">{{ error }}</p>
  <div class="mb-ctemp__foot">
    <button type="button" class="mb-ctemp__button" :disabled="busy" @click="back">Back</button>
    <button v-if="teamId" type="button" class="mb-ctemp__button mb-ctemp__button--primary" :disabled="!adding.length || busy" @click="add">
      {{ addLabel(adding.length, busy) }}
    </button>
  </div>
</template>

<style scoped src="./MercbotChangeTemplateDialog.css"></style>
<style scoped>
.mb-team__intro {
  margin: 0 0 14px;
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-team__name {
  margin: 0 0 4px;
  font-size: 18px;
  font-weight: 600;
}

.mb-team__list,
.mb-team__bots {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mb-team__choice,
.mb-team__bot {
  padding: 10px 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 14px;
}

.mb-team__choice {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.mb-team__choice:hover,
.mb-team__choice:focus-visible {
  background: rgb(var(--v-theme-surface-container-low));
  outline: none;
}

.mb-team__pick {
  display: flex;
  align-items: center;
  gap: 12px;
  cursor: pointer;
}

.mb-team__pick input,
.mb-team__app input {
  flex: none;
  margin: 0;
  accent-color: rgb(var(--v-theme-secondary));
}

.mb-team__bot--in .mb-team__pick {
  cursor: default;
}

.mb-team__bot--in .mb-face,
.mb-team__bot--in .mb-team__line {
  opacity: 0.6;
}

.mb-team__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 13px;
  line-height: 18px;
}

.mb-team__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.mb-team__line {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-team__in {
  padding: 0 8px;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 11px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-team__faces {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
}

.mb-team__count {
  margin-left: 4px;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-team__app {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 8px 0 0 25px;
  font-size: 13px;
}
</style>
