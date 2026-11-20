<script setup>
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { useDisplay } from "vuetify";
import TemplateAvatar from "../templates/TemplateAvatar.vue";
import TemplateBrowser from "../templates/TemplateBrowser.vue";
import TemplateContents from "../templates/TemplateContents.vue";
import TemplateTested from "../templates/TemplateTested.vue";
import { templatesApi } from "../templates/templatesApi.js";
import { appsApi } from "../apps/appsApi.js";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotTeamScreen from "./MercbotTeamScreen.vue";
import MercbotTemplateDraft from "./MercbotTemplateDraft.vue";
import MercbotTemplateTag from "./MercbotTemplateTag.vue";
import { BOT_COLOURS, BOT_PALETTE } from "@/theme/palettes.js";
import { isBlack } from "./accent.js";
import { SHAPES, SPECIAL_SHAPE } from "./avatarShapes.js";
import { botsApi } from "./botsApi.js";

// New bot (D-98, amended 20 November). First, what it will do: Mercbot's all-round General helper, one of the home's own
// templates (listed first), one of Mercbot's library (search, job areas and Tested badges, as the gallery shows them),
// or Make a new template, drafted from a sentence on the draft screen. A template chosen is shown whole before Next.
// Then its name, cloud and colour, and Create: the shell creates it (useNewBot.js) with the template chosen, so a new
// template and its bot are made together. A template a link opens (?template=) starts New bot with it chosen; a bot a
// person shared keeps its own name and look, so it's added from there. Add a team, at the foot of the templates, makes a
// few bots at once (D-105: MercbotTeamScreen.vue); a new home's first conversation or its New home form starts New bot
// there with the team chosen. On a phone it fills the screen.
const props = defineProps({
  busy: { type: Boolean, default: false },
  error: { type: String, default: "" },
  // A refused new template's problems, shown at their parts on the draft screen.
  problems: { type: Array, default: () => [] },
  // A name to start with, as from the group picker's "create a new bot" offer.
  initialName: { type: String, default: "" },
  // The home's bots, so a new one starts in a colour and cloud nobody has yet (D-44).
  bots: { type: Array, default: () => [] },
  // The template a link opened New bot with: one of Mercbot's library, or a bot a person shared.
  templateSlug: { type: String, default: "" },
  // The team chosen elsewhere (D-105): New bot opens on its team screen.
  teamId: { type: String, default: "" }
});
const open = defineModel({ type: Boolean, default: false });
const emit = defineEmits(["create", "addTeam"]);

const display = useDisplay();
const phone = computed(() => display.width.value < 600);
// pick, preview (a template chosen), draft (Make a new template), look (name, cloud and colour) or team (Add a team).
const step = ref("pick");
// The team on the team screen, "" for the list of teams.
const team = ref("");
const teamScreen = ref(null);
const home = ref(null);
// The template chosen: as the browser gave it ({ library }, { home }), { link } from a link, { general } or { draft }.
const chosen = shallowRef(null);
const detail = ref(null);
const loadFailed = ref(false);
const appChoice = ref(null);
const withApp = ref(true);
// Make a new template: the draft screen stays while the look is chosen, and the draft it saved goes with Create.
const drafting = ref(false);
const draftScreen = ref(null);
const drafted = ref(null);
// Leaving a draft not yet made into a bot asks first: what to do once agreed.
const leaving = shallowRef(null);
const asking = computed({ get: () => Boolean(leaving.value), set: (value) => { if (!value) leaving.value = null; } });
const browser = ref(null);

const name = ref("");
const shape = ref(SHAPES[0].id);
const color = ref(BOT_PALETTE[0].color);
const nameInput = ref(null);
const special = computed(() => shape.value === SPECIAL_SHAPE.id);
const shownColor = computed(() => (special.value ? SPECIAL_SHAPE.color : color.value));
const canCreate = computed(() => Boolean(name.value.trim()) && !props.busy);
const preview = computed(() => ({ id: "new", name: name.value || "New bot", shape: shape.value, color: shownColor.value }));
const pickAny = (list) => list[Math.floor(Math.random() * list.length)];
// A random choice, from those not taken yet while any are left.
function pickFresh(list, taken) {
  const fresh = list.filter((entry) => !taken.has(entry));
  return pickAny(fresh.length ? fresh : list);
}
// Every cloud, Mercbot's own last, ten to a row (D-44).
const rows = Array.from({ length: Math.ceil((SHAPES.length + 1) / 10) }, (_, index) => [...SHAPES, SPECIAL_SHAPE].slice(index * 10, index * 10 + 10));
const colourRows = [BOT_PALETTE.slice(0, 6), BOT_PALETTE.slice(6)];

// A template of Mercbot's library is the team's; one a link opens that isn't is a bot a person shared.
const library = computed(() => Boolean(detail.value?.team));
const shared = computed(() => Boolean(chosen.value?.link) && Boolean(detail.value) && !library.value);
const chosenTag = computed(() => detail.value && { template: { tag: detail.value.tag, source: chosen.value?.home ? "home" : "library", description: detail.value.description } });
const homeTags = computed(() => (home.value || []).map((template) => template.tag));
const title = computed(() => ({ pick: "New bot", preview: "New bot", draft: "Make a new template", look: "Name your bot", team: "Add a team" })[step.value]);

watch(open, async (value) => {
  if (!value) return;
  const bots = props.bots.filter((bot) => bot.kind !== "group");
  step.value = "pick";
  chosen.value = null;
  detail.value = null;
  drafting.value = false;
  drafted.value = null;
  home.value = null;
  name.value = props.initialName;
  shape.value = pickFresh(SHAPES.map((entry) => entry.id), new Set(bots.map((bot) => bot.shape)));
  color.value = pickFresh(BOT_PALETTE.map((entry) => entry.color), new Set(bots.map((bot) => (isBlack(bot.color) ? BOT_COLOURS.Black : String(bot.color).toUpperCase()))));
  botsApi.homeTemplates().then((read) => { home.value = read.templates; }).catch(() => { home.value = []; });
  team.value = props.teamId;
  if (props.teamId) return toTeams();
  if (props.templateSlug) return choose({ link: props.templateSlug });
  await nextTick();
  browser.value?.focusSearch();
}, { immediate: true });

// A refused new template goes back to the draft screen, its problems at their parts.
watch(() => props.problems, (list) => {
  if (list.length && drafting.value) step.value = "draft";
});

async function choose(choice) {
  chosen.value = choice;
  detail.value = null;
  appChoice.value = null;
  loadFailed.value = false;
  if (choice.general) return toLook();
  step.value = "preview";
  try {
    const read = choice.home ? await botsApi.homeTemplate(choice.home) : await templatesApi.template(choice.library || choice.link);
    if (chosen.value !== choice) return;
    detail.value = read;
  } catch {
    if (chosen.value === choice) loadFailed.value = true;
    return;
  }
  if (detail.value.appTemplate) {
    const { templates = [], canManage } = await appsApi.templates().catch(() => ({}));
    const app = templates.find((entry) => entry.key === detail.value.appTemplate);
    if (app && chosen.value === choice) appChoice.value = { ...app, canManage: Boolean(canManage) };
  }
}

// Next: a template of Mercbot's library brings its own name and look, which can be changed.
function toLook() {
  if (detail.value && !chosen.value?.home && !name.value.trim()) {
    name.value = detail.value.name;
    if (detail.value.shape) shape.value = detail.value.shape;
    if (detail.value.color) color.value = detail.value.color;
  }
  step.value = "look";
  nextTick(() => nameInput.value?.focus());
}

function makeTemplate() {
  chosen.value = null;
  detail.value = null;
  drafting.value = true;
  step.value = "draft";
}

function saveDraft({ draft }) {
  drafted.value = draft;
  chosen.value = { draft };
  toLook();
}

/** Add a team: the list of teams, or the one chosen. */
function toTeams() {
  step.value = "team";
}

function toPicker() {
  step.value = "pick";
  team.value = "";
  drafting.value = false;
  nextTick(() => browser.value?.focusSearch());
}

function back() {
  if (props.busy) return;
  if (step.value === "team") teamScreen.value?.back();
  else if (step.value === "look" && drafting.value) step.value = "draft";
  else if (step.value === "look" && !chosen.value?.general) step.value = "preview";
  else if (step.value === "draft" && draftScreen.value?.dirty) leaving.value = toPicker;
  else toPicker();
}

function pickColour(value) {
  color.value = value;
  if (special.value) shape.value = SHAPES[0].id;
}

/** What Create asks the shell to make: the look and the template chosen (none for the General helper). */
function create() {
  if (shared.value) {
    emit("create", { name: detail.value.name, link: props.templateSlug });
    return;
  }
  if (!canCreate.value) return;
  const template = chosen.value?.draft
    ? { draft: drafted.value }
    : chosen.value?.home ? { home: chosen.value.home } : library.value ? { library: detail.value.slug } : null;
  const app = library.value && appChoice.value?.canManage && withApp.value ? appChoice.value : null;
  emit("create", { name: name.value.trim(), shape: shape.value, color: shownColor.value, ...(template ? { template } : {}), ...(app ? { app } : {}) });
}

// A draft not yet made into a bot is lost on closing: asked first.
function close() {
  if (props.busy) return;
  if (drafting.value && draftScreen.value?.dirty) leaving.value = () => { open.value = false; };
  else open.value = false;
}

function onKeydown(event) {
  if (event.key !== "Escape" || step.value === "pick") return;
  event.preventDefault();
  event.stopPropagation();
  back();
}
</script>

<template>
  <v-dialog :model-value="open" width="auto" :fullscreen="phone" :persistent="busy || drafting" @update:model-value="close">
    <div class="mb-ctemp" :class="{ 'mb-ctemp--phone': phone }" role="dialog" aria-label="New bot" @keydown="onKeydown">
      <div class="mb-ctemp__head">
        <h2 class="mb-ctemp__title">{{ title }}</h2>
        <button type="button" class="mb-ctemp__close" aria-label="Close" :disabled="busy" @click="close">
          <v-icon icon="$close" :size="phone ? 18 : 14" />
        </button>
      </div>

      <div class="mb-ctemp__body">
        <div v-show="step === 'pick'" class="mb-ctemp__picker" :inert="step !== 'pick'">
          <p class="mb-newbot__question">What will it do?</p>
          <TemplateBrowser ref="browser" picking :home="home || []" class="mb-ctemp__browser" @pick="choose">
            <template #lead>
              <button type="button" class="mb-newbot__lead" data-template-entry @click="choose({ general: true })">
                <MercbotAvatar :bot="{ id: 'general', name: 'General helper', shape: SHAPES[0].id, color: shownColor }" :size="40" still />
                <span class="mb-newbot__lead-text">
                  <strong>General helper</strong>
                  <span>An all-round helper for whatever you ask: it asks what you need and grows from there.</span>
                </span>
                <v-icon icon="$chevronRight" size="18" />
              </button>
            </template>
            <template #foot>
              <button type="button" class="mb-newbot__team" data-template-entry @click="toTeams">
                <v-icon icon="$groupAdd" size="20" />
                <span class="mb-newbot__lead-text">
                  <strong>Add a team</strong>
                  <span>A few bots for one situation, such as a small shop or a busy household, made together.</span>
                </span>
                <v-icon icon="$chevronRight" size="18" />
              </button>
            </template>
          </TemplateBrowser>
          <div class="mb-ctemp__foot mb-ctemp__picker-foot">
            <span class="mb-ctemp__hint">Nothing that fits?</span>
            <button type="button" class="mb-ctemp__button" @click="makeTemplate"><v-icon icon="$editSquare" size="15" /> Make a new template</button>
          </div>
        </div>

        <div v-if="drafting" v-show="step === 'draft'" class="mb-ctemp__step">
          <button type="button" class="mb-ctemp__step-link mb-ctemp__draft-back" :disabled="busy" @click="back"><v-icon icon="$chevronLeft" size="16" /> All templates</button>
          <MercbotTemplateDraft
            ref="draftScreen"
            class="mb-ctemp__draft"
            purpose="new"
            :home-tags="homeTags"
            save-label="Save and use"
            :save-problems="problems"
            @save="saveDraft"
          />
        </div>

        <Transition name="mb-ctemp-step">
          <div v-if="step === 'preview'" class="mb-ctemp__step">
            <div class="mb-ctemp__scroll">
              <button type="button" class="mb-ctemp__step-link" @click="back"><v-icon icon="$chevronLeft" size="16" /> All templates</button>
              <div v-if="loadFailed" class="mb-ctemp__state" role="alert">
                <p>{{ chosen?.link ? "There's no bot at that link. It may have been removed." : "That template couldn't be loaded." }}</p>
                <button v-if="!chosen?.link" type="button" class="mb-set-pill" @click="choose(chosen)">Try again</button>
              </div>
              <div v-else-if="!detail" class="mb-ctemp__state" role="status" aria-label="Loading the template" />
              <template v-else-if="chosen.home">
                <div class="mb-ctemp__who">
                  <span class="mb-ctemp__home-face"><v-icon icon="$home" size="26" /></span>
                  <div class="mb-ctemp__who-text">
                    <h3 class="mb-ctemp__name">{{ detail.tag }} <MercbotTemplateTag :bot="chosenTag" size="medium" :tooltip="false" /></h3>
                    <p class="mb-ctemp__by">Your home's template · {{ detail.usedBy === 1 ? "used by 1 bot" : `used by ${detail.usedBy} bots` }}</p>
                  </div>
                </div>
                <p class="mb-ctemp__description">{{ detail.description }}</p>
                <p class="mb-ctemp__label"><v-icon icon="$lock" size="13" /> Its instructions</p>
                <div class="mb-ctemp__text">{{ detail.instructions }}</div>
                <template v-if="detail.skills?.length">
                  <p class="mb-ctemp__label">Its skills</p>
                  <ul class="mb-ctemp__skills">
                    <li v-for="skill in detail.skills" :key="skill.name"><strong>{{ skill.name }}</strong> {{ skill.description }}</li>
                  </ul>
                </template>
              </template>
              <template v-else>
                <div class="mb-ctemp__who">
                  <TemplateAvatar :template="detail" :size="56" />
                  <div class="mb-ctemp__who-text">
                    <h3 class="mb-ctemp__name">{{ detail.name }} <MercbotTemplateTag v-if="detail.tag" :bot="chosenTag" size="medium" :tooltip="false" /></h3>
                    <p class="mb-ctemp__by">
                      {{ library ? `Mercbot's library, by ${detail.creator}` : `Shared by ${detail.creator}, not by Mercbot` }}
                      <TemplateTested v-if="library" :template="detail" />
                    </p>
                  </div>
                </div>
                <p class="mb-ctemp__description">{{ detail.description }}</p>
                <p class="mb-ctemp__note">
                  It may act on your behalf with the apps you connect, and asks before sending anything. Here's everything it's told to do; read it before
                  adding it.
                </p>
                <TemplateContents :template="detail" all />
                <label v-if="appChoice?.canManage" class="mb-newbot__app">
                  <input v-model="withApp" type="checkbox">
                  Also set up the {{ appChoice.name }} app it works with, as a draft for you to review
                </label>
                <p v-else-if="appChoice" class="mb-ctemp__note">It works with a {{ appChoice.name }} app, which an owner or admin of this home can add from Apps → Templates.</p>
              </template>
            </div>
            <p v-if="error && shared" class="mb-ctemp__error" role="alert">{{ error }}</p>
            <div class="mb-ctemp__foot">
              <button type="button" class="mb-ctemp__button" :disabled="busy" @click="back">Back</button>
              <button v-if="shared" type="button" class="mb-ctemp__button mb-ctemp__button--primary" :disabled="busy" @click="create">{{ busy ? "Adding…" : "Add bot" }}</button>
              <button v-else type="button" class="mb-ctemp__button mb-ctemp__button--primary" :disabled="!detail" @click="toLook">Next</button>
            </div>
          </div>
        </Transition>

        <Transition name="mb-ctemp-step">
          <div v-if="step === 'team'" class="mb-ctemp__step">
            <MercbotTeamScreen ref="teamScreen" v-model:team="team" :busy="busy" :error="error" @add="emit('addTeam', $event)" @back="toPicker" />
          </div>
        </Transition>

        <Transition name="mb-ctemp-step">
          <div v-if="step === 'look'" class="mb-ctemp__step">
            <div class="mb-ctemp__scroll mb-newbot__look">
              <button type="button" class="mb-ctemp__step-link" :disabled="busy" @click="back">
                <v-icon icon="$chevronLeft" size="16" /> {{ drafting ? "The template" : chosen?.general ? "All templates" : "Back" }}
              </button>
              <p class="mb-newbot__chosen">
                <template v-if="drafting">On <strong>{{ drafted.tag }}</strong>, a new template of your home's, saved when you create the bot</template>
                <template v-else-if="chosen?.general">A <strong>General helper</strong>: it asks what you need</template>
                <template v-else>On <strong>{{ detail.tag }}</strong>{{ chosen?.home ? ", your home's template" : ", from Mercbot's library" }}</template>
              </p>
              <div class="mb-newbot__preview"><MercbotAvatar :bot="preview" :size="100" /></div>

              <input
                ref="nameInput"
                v-model="name"
                class="mb-newbot__name"
                aria-label="Bot name"
                placeholder="What should your bot be called?"
                maxlength="80"
                :disabled="busy"
                @keydown.enter.prevent="create"
              >

              <div class="mb-newbot__shapes" role="radiogroup" aria-label="Shape">
                <div v-for="(row, rowIndex) in rows" :key="rowIndex" class="mb-newbot__row mb-newbot__row--shapes">
                  <button
                    v-for="entry in row"
                    :key="entry.id"
                    type="button"
                    role="radio"
                    class="mb-newbot__shape"
                    :class="{ 'mb-newbot__shape--selected': shape === entry.id }"
                    :aria-checked="shape === entry.id"
                    :aria-label="entry.label"
                    :disabled="busy"
                    @click="shape = entry.id"
                  >
                    <MercbotAvatar :bot="{ id: `shape-${entry.id}`, name: entry.label, shape: entry.id, color: shownColor }" :size="32" still />
                  </button>
                </div>
              </div>

              <div class="mb-newbot__colours" role="radiogroup" aria-label="Colour">
                <div v-for="(row, rowIndex) in colourRows" :key="rowIndex" class="mb-newbot__row mb-newbot__row--colours">
                  <button
                    v-for="entry in row"
                    :key="entry.color"
                    type="button"
                    role="radio"
                    class="mb-newbot__colour"
                    :class="{ 'mb-newbot__colour--selected': !special && color === entry.color }"
                    :style="{ background: entry.color }"
                    :aria-checked="!special && color === entry.color"
                    :aria-label="entry.name"
                    :disabled="busy"
                    @click="pickColour(entry.color)"
                  />
                </div>
              </div>
            </div>
            <p v-if="error" class="mb-ctemp__error" role="alert">{{ error }}</p>
            <div class="mb-ctemp__foot">
              <button type="button" class="mb-ctemp__button" :disabled="busy" @click="back">Back</button>
              <button type="button" class="mb-ctemp__button mb-ctemp__button--primary" :disabled="!canCreate" @click="create">
                {{ busy ? "Creating…" : "Create" }}
              </button>
            </div>
          </div>
        </Transition>
      </div>
    </div>
    <MercbotConfirmDialog
      v-model="asking"
      title="Leave the new template?"
      text="It isn't saved yet: the draft is lost when you leave it."
      confirm-label="Leave"
      @confirm="leaving?.()"
    />
  </v-dialog>
</template>

<style scoped src="./MercbotChangeTemplateDialog.css"></style>
<style scoped src="./MercbotNewBotDialog.css"></style>
