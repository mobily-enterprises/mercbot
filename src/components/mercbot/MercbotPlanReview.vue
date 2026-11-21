<script setup>
import { computed, onMounted, ref } from "vue";
import TemplateContents from "../templates/TemplateContents.vue";
import { templatesApi } from "../templates/templatesApi.js";
import { appsApi } from "../apps/appsApi.js";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotTemplateDraft from "./MercbotTemplateDraft.vue";
import MercbotTemplateTag from "./MercbotTemplateTag.vue";
import { addLabel, appsFor } from "./teamChoice.js";
import { firstQuestions } from "./useBotPlan.js";

// Add bots' Suggested bots (D-109): the plan for what the person described, before anything is added. Mercbot's
// library bots first, each with why, View (everything it's told) and, for someone who may set up apps, the app it works
// with; then the home's own templates; then new bots, written for this home, each with its job, why and the first
// questions it asks, Read it all and Edit (the draft screen, MercbotTemplateDraft.vue) once its template is written,
// "Writing its template…" until then, and "Couldn't write this one" with Try again and Remove. A library bot already
// in the home is shown unticked, and the home's bots that already do a job are listed with why. The section the bots
// go in is named here; "Not quite right?" plans again with what to change; Add N bots makes the bots ticked.
const props = defineProps({
  // The plan's state (useBotPlan.js), made by Add bots.
  planner: { type: Object, required: true },
  busy: { type: Boolean, default: false },
  error: { type: String, default: "" },
  homeTags: { type: Array, default: () => [] }
});
const emit = defineEmits(["add", "back"]);
const { describe, plan, bots, drafts, unticked, section, adding, ready, batch, asking, failure, suggest, write, tick, useDraft } = props.planner;

const GROUPS = [
  { id: "library", name: "From Mercbot's library", has: (bot) => Boolean(bot.library) },
  { id: "home", name: "Your home's templates", has: (bot) => Boolean(bot.home) },
  { id: "new", name: "New, written for this home", has: (bot) => Boolean(bot.new) }
];
const groups = computed(() => GROUPS.map((group) => ({ ...group, bots: bots.value.filter(group.has) })).filter((group) => group.bots.length));
const tagOf = (bot) => ({ template: { tag: bot.tag, source: bot.library ? "library" : "home", description: bot.description } });
const ticked = (bot) => !bot.inHome && !unticked.value.has(bot.key);

// A library bot's whole template, read when View is pressed: "loading", "failed" or the template.
const viewing = ref({});
async function view(bot) {
  if (viewing.value[bot.key]) {
    const rest = { ...viewing.value };
    delete rest[bot.key];
    viewing.value = rest;
    return;
  }
  viewing.value = { ...viewing.value, [bot.key]: "loading" };
  const read = await templatesApi.template(bot.library).catch(() => "failed");
  viewing.value = { ...viewing.value, [bot.key]: read };
}

// A new bot's whole template shown (Read it all), and the one on the draft screen (Edit).
const reading = ref(new Set());
function readAll(key) {
  const next = new Set(reading.value);
  if (!next.delete(key)) next.add(key);
  reading.value = next;
}
const editing = ref("");
function saveEdit({ draft }) {
  useDraft(editing.value, draft);
  editing.value = "";
}

// The apps the library bots work with, when the person may set them up, and those left out.
const apps = ref(new Map());
const withoutApp = ref(new Set());
const appOf = (bot) => (bot.appTemplate ? apps.value.get(bot.appTemplate) || null : null);
function tickApp(key) {
  const next = new Set(withoutApp.value);
  if (!next.delete(key)) next.add(key);
  withoutApp.value = next;
}
onMounted(async () => {
  const { templates = [], canManage } = await appsApi.templates().catch(() => ({}));
  apps.value = canManage ? new Map(templates.map((app) => [app.key, app])) : new Map();
});

const changeWords = ref("");
async function change() {
  const words = changeWords.value.trim();
  if (!words || asking.value) return;
  if (await suggest(describe.value, words)) changeWords.value = "";
}

const waiting = computed(() => adding.value.some((bot) => bot.new && drafts.value[bot.key]?.state !== "ready"));
const hasNew = computed(() => bots.value.some((bot) => bot.new));

function add() {
  if (!ready.value || props.busy) return;
  const library = adding.value.filter((bot) => bot.library).map((bot) => ({ slug: bot.library, appTemplate: bot.appTemplate }));
  emit("add", { ...batch.value, apps: appsFor(library, apps.value, new Set([...withoutApp.value].map((key) => key.replace(/^library:/u, "")))) });
}
</script>

<template>
  <template v-if="editing">
    <button type="button" class="mb-ctemp__step-link mb-ctemp__draft-back" @click="editing = ''">
      <v-icon icon="$chevronLeft" size="16" /> Suggested bots
    </button>
    <MercbotTemplateDraft
      class="mb-ctemp__draft"
      purpose="edit"
      :start="drafts[editing].draft"
      :home-tags="homeTags"
      save-label="Use this"
      @save="saveEdit"
    />
  </template>
  <template v-else>
    <div class="mb-ctemp__scroll">
      <button type="button" class="mb-ctemp__step-link" :disabled="busy" @click="emit('back')">
        <v-icon icon="$chevronLeft" size="16" /> Add bots
      </button>
      <p class="mb-plan__for">For: “{{ describe }}”</p>
      <p v-if="plan?.summary" class="mb-plan__summary">{{ plan.summary }}</p>

      <section v-for="group in groups" :key="group.id" class="mb-plan__group" :aria-label="group.name">
        <h3 class="mb-plan__group-name">{{ group.name }}</h3>
        <ul class="mb-plan__bots">
          <li v-for="bot in group.bots" :key="bot.key" class="mb-plan__bot" :class="{ 'mb-plan__bot--in': bot.inHome }">
            <label class="mb-plan__pick">
              <input
                type="checkbox"
                :checked="ticked(bot)"
                :disabled="bot.inHome || busy"
                :aria-label="bot.inHome ? `${bot.name}, ${bot.archivedInHome ? 'archived' : 'already'} in this home` : `Add ${bot.name}`"
                @change="tick(bot.key)"
              >
              <MercbotAvatar :bot="{ id: `plan-${bot.key}`, name: bot.name, color: bot.color, shape: bot.shape }" :size="40" still />
              <span class="mb-plan__text">
                <span class="mb-plan__head">
                  <strong>{{ bot.name }}</strong>
                  <MercbotTemplateTag :bot="tagOf(bot)" :tooltip="false" />
                  <span v-if="bot.new" class="mb-plan__badge">New</span>
                  <span v-if="bot.inHome" class="mb-plan__badge">{{ bot.archivedInHome ? "Archived in this home" : "Already in this home" }}</span>
                </span>
                <span class="mb-plan__line">{{ bot.description }}</span>
              </span>
            </label>
            <div class="mb-plan__more">
              <p v-if="bot.why && !bot.inHome" class="mb-plan__why">Why: {{ bot.why }}</p>

              <template v-if="bot.library && !bot.inHome">
                <button type="button" class="mb-plan__link" :aria-expanded="Boolean(viewing[bot.key])" @click="view(bot)">
                  {{ viewing[bot.key] ? "Hide" : "View" }}
                </button>
                <p v-if="viewing[bot.key] === 'failed'" class="mb-ctemp__note">It couldn't be loaded.</p>
                <div v-else-if="viewing[bot.key] === 'loading'" class="mb-ctemp__state" role="status" :aria-label="`Loading ${bot.name}`" />
                <TemplateContents v-else-if="viewing[bot.key]" :template="viewing[bot.key]" all />
                <label v-if="appOf(bot) && ticked(bot)" class="mb-plan__app">
                  <input type="checkbox" :checked="!withoutApp.has(bot.key)" :disabled="busy" @change="tickApp(bot.key)">
                  <span>Also set up its {{ appOf(bot).name }} app, as a draft for you to review</span>
                </label>
              </template>

              <template v-if="bot.new">
                <p v-if="drafts[bot.key]?.state === 'failed'" class="mb-plan__failed" role="alert">
                  Couldn't write this one: {{ drafts[bot.key].message }}
                  <button type="button" class="mb-plan__link" :disabled="busy" @click="write(bot.key)">Try again</button>
                  <button v-if="ticked(bot)" type="button" class="mb-plan__link" :disabled="busy" @click="tick(bot.key)">Remove</button>
                </p>
                <template v-else-if="drafts[bot.key]?.state === 'ready'">
                  <p v-if="firstQuestions(drafts[bot.key].draft).length" class="mb-plan__asks">
                    Asks first: {{ firstQuestions(drafts[bot.key].draft).join("; ") }}
                  </p>
                  <span class="mb-plan__actions">
                    <button type="button" class="mb-plan__link" :aria-expanded="reading.has(bot.key)" @click="readAll(bot.key)">
                      {{ reading.has(bot.key) ? "Hide it" : "Read it all" }}
                    </button>
                    <button type="button" class="mb-plan__link" :disabled="busy" @click="editing = bot.key">Edit</button>
                  </span>
                  <div v-if="reading.has(bot.key)" class="mb-plan__whole" :aria-label="`${bot.name}'s template`">
                    <p class="mb-ctemp__label">Its first message</p>
                    <div class="mb-ctemp__text">{{ drafts[bot.key].draft.greeting }}</div>
                    <p class="mb-ctemp__label">Its instructions</p>
                    <div class="mb-ctemp__text">{{ drafts[bot.key].draft.instructions }}</div>
                    <template v-for="skill in drafts[bot.key].draft.skills" :key="skill.name">
                      <p class="mb-ctemp__label">{{ skill.name }}</p>
                      <div class="mb-ctemp__text">{{ skill.instructions }}</div>
                    </template>
                  </div>
                </template>
                <p v-else class="mb-plan__writing" role="status">Writing its template…</p>
              </template>
            </div>
          </li>
        </ul>
      </section>

      <section v-if="plan?.covered?.length" class="mb-plan__group" aria-label="Already doing it">
        <h3 class="mb-plan__group-name">Already doing it in this home</h3>
        <ul class="mb-plan__covered">
          <li v-for="entry in plan.covered" :key="entry.botId"><strong>{{ entry.name }}</strong>{{ entry.why ? `: ${entry.why}` : "" }}</li>
        </ul>
      </section>

      <p v-if="hasNew" class="mb-ctemp__note">
        New templates are saved in this home only, in Settings → Templates, where an owner can change or delete them.
        Like every bot, these ask before anything leaves the chat.
      </p>

      <label class="mb-plan__section">
        <span>Section in your sidebar</span>
        <input v-model="section" maxlength="40" :disabled="busy">
      </label>

      <form class="mb-plan__change" @submit.prevent="change">
        <label for="mb-plan-change">Not quite right?</label>
        <input id="mb-plan-change" v-model="changeWords" maxlength="600" placeholder="Tell Mercbot what to change…" :disabled="asking || busy">
        <button type="submit" class="mb-ctemp__button" :disabled="!changeWords.trim() || asking || busy">{{ asking ? "Changing…" : "Change" }}</button>
      </form>
    </div>
    <p v-if="error || failure" class="mb-ctemp__error" role="alert">{{ error || failure }}</p>
    <div class="mb-ctemp__foot">
      <span v-if="waiting" class="mb-ctemp__hint">Waiting for the new templates…</span>
      <button type="button" class="mb-ctemp__button" :disabled="busy" @click="emit('back')">Back</button>
      <button type="button" class="mb-ctemp__button mb-ctemp__button--primary" :disabled="!ready || busy || asking" @click="add">
        {{ addLabel(adding.length, busy) }}
      </button>
    </div>
  </template>
</template>

<style scoped src="./MercbotChangeTemplateDialog.css"></style>
<style scoped>
.mb-plan__for {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
}

.mb-plan__summary {
  margin: 0 0 12px;
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-plan__group {
  margin-top: 16px;
}

.mb-plan__group-name {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-plan__bots,
.mb-plan__covered {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mb-plan__bot {
  padding: 10px 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 14px;
}

.mb-plan__pick {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  cursor: pointer;
}

.mb-plan__pick input,
.mb-plan__app input {
  flex: none;
  margin: 0;
  accent-color: rgb(var(--v-theme-secondary));
}

.mb-plan__bot--in .mb-plan__pick {
  cursor: default;
}

.mb-plan__bot--in .mb-face,
.mb-plan__bot--in .mb-plan__line {
  opacity: 0.6;
}

.mb-plan__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
  font-size: 13px;
  line-height: 18px;
}

.mb-plan__head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.mb-plan__line,
.mb-plan__why,
.mb-plan__asks,
.mb-plan__writing,
.mb-plan__covered {
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-plan__badge {
  padding: 0 8px;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 11px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-plan__more {
  margin-left: 25px;
}

.mb-plan__more > p {
  margin: 4px 0 0;
}

.mb-plan__failed {
  font-size: 13px;
  color: rgb(var(--v-theme-error));
}

.mb-plan__actions {
  display: flex;
  gap: 12px;
}

.mb-plan__link {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}

.mb-plan__app {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  font-size: 13px;
  line-height: 18px;
  cursor: pointer;
}

.mb-plan__section,
.mb-plan__change {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  font-size: 13px;
}

.mb-plan__section input,
.mb-plan__change input {
  flex: 1 1 200px;
  min-width: 0;
  padding: 6px 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 10px;
  background: transparent;
  font: inherit;
  color: inherit;
}

@media (max-width: 599px) {
  .mb-plan__more {
    margin-left: 0;
  }
}
</style>
