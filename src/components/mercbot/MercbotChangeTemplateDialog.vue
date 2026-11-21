<script setup>
import { computed, nextTick, ref, shallowRef, watch } from "vue";
import { useDisplay } from "vuetify";
import TemplateAvatar from "../templates/TemplateAvatar.vue";
import TemplateBrowser from "../templates/TemplateBrowser.vue";
import TemplateTested from "../templates/TemplateTested.vue";
import { templatesApi } from "../templates/templatesApi.js";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotTemplateDraft from "./MercbotTemplateDraft.vue";
import MercbotTemplateTag from "./MercbotTemplateTag.vue";
import { botsApi } from "./botsApi.js";

// Change template (D-98): the picker (the home's own templates first, then Mercbot's library, as New bot shows them),
// then a confirm showing the chosen template's instructions and skills in full and the bot's additions, which it keeps
// under the new template. Change template points the bot at it; the bot then says so and asks the new template's setup
// questions in the person's chat with it. Escape on the confirm goes back to the picker. At the picker's foot, Make a new template
// drafts one from a sentence, and Start from this bot drafts one from the bot itself (amended 20 November), on the draft
// screen: Save and use makes it a template of the home's and points the bot at it, in one go. On a phone it fills the
// screen, with its close, title and action in a bar at the top.
const props = defineProps({
  bot: { type: Object, required: true },
  // The bot's additions, which stay.
  additions: { type: String, default: "" }
});
const open = defineModel({ type: Boolean, default: false });
const emit = defineEmits(["changed"]);

const display = useDisplay();
const phone = computed(() => display.width.value < 600);
const home = ref(null);
// The choice as the browser gave it, kept as is (not made reactive), so a reply is matched to the choice it answers.
const chosen = shallowRef(null);
const detail = ref(null);
const loadFailed = ref(false);
const busy = ref(false);
const problem = ref("");
const browser = ref(null);
const back = ref(null);
// Make a new template ("new") or Start from this bot ("from-bot"), on the draft screen; a save's refused problems.
const drafting = ref("");
const draftScreen = ref(null);
const saveProblems = ref([]);
// Leaving a draft not yet saved asks first: what to do once agreed.
const leaving = shallowRef(null);
const asking = computed({ get: () => Boolean(leaving.value), set: (value) => { if (!value) leaving.value = null; } });
const homeTags = computed(() => (home.value || []).map((template) => template.tag));

const library = computed(() => Boolean(chosen.value?.library));
// What the chosen template's tag looks like on a bot.
const chosenTag = computed(() => detail.value && { template: { tag: detail.value.tag, source: library.value ? "library" : "home", description: detail.value.description } });
const current = computed(() => {
  const now = props.bot.template;
  if (!now || !detail.value) return false;
  return now.source === (library.value ? "library" : "home") && now.tag === detail.value.tag;
});
const canChange = computed(() => Boolean(detail.value) && !current.value && !busy.value);

watch(open, async (value) => {
  if (!value) return;
  chosen.value = null;
  detail.value = null;
  problem.value = "";
  drafting.value = "";
  home.value = null;
  botsApi.homeTemplates().then((read) => { home.value = read.templates; }).catch(() => { home.value = []; });
  await nextTick();
  browser.value?.focusSearch();
}, { immediate: true });

async function pick(choice) {
  chosen.value = choice;
  detail.value = null;
  loadFailed.value = false;
  problem.value = "";
  try {
    const read = choice.library ? await templatesApi.template(choice.library) : await botsApi.homeTemplate(choice.home);
    if (chosen.value === choice) detail.value = read;
  } catch {
    if (chosen.value === choice) loadFailed.value = true;
  }
  await nextTick();
  back.value?.focus();
}

function toPicker() {
  if (busy.value) return;
  if (drafting.value && draftScreen.value?.dirty && !leaving.value) {
    leaving.value = () => {
      drafting.value = "";
      toPicker();
    };
    return;
  }
  chosen.value = null;
  drafting.value = "";
  problem.value = "";
  nextTick(() => browser.value?.focusSearch());
}

function startDraft(purpose) {
  problem.value = "";
  saveProblems.value = [];
  drafting.value = purpose;
}

/** Save and use: the draft becomes a template of the home's and the bot's, in one call; its additions folded if ticked. */
async function saveDraft({ draft, foldAdditions }) {
  busy.value = true;
  problem.value = "";
  try {
    const { bot } = await botsApi.changeTemplate(props.bot.id, { draft, foldAdditions: drafting.value === "from-bot" && foldAdditions });
    emit("changed", bot);
    drafting.value = "";
    open.value = false;
  } catch (error) {
    saveProblems.value = error?.params?.problems || [];
    problem.value = saveProblems.value.length ? "Put the template's problems right, then save it again." : error?.message || "That didn't work. Try again.";
  }
  busy.value = false;
}

async function change() {
  if (!canChange.value) return;
  busy.value = true;
  problem.value = "";
  try {
    const { bot } = await botsApi.changeTemplate(props.bot.id, chosen.value);
    emit("changed", bot);
    open.value = false;
  } catch (error) {
    problem.value = error?.message || "That didn't work. Try again.";
  }
  busy.value = false;
}

function close() {
  if (busy.value) return;
  if (drafting.value && draftScreen.value?.dirty) leaving.value = () => { open.value = false; };
  else open.value = false;
}

function onKeydown(event) {
  if (event.key === "Escape" && (chosen.value || drafting.value)) {
    event.preventDefault();
    event.stopPropagation();
    toPicker();
  }
}
</script>

<template>
  <v-dialog :model-value="open" width="auto" :fullscreen="phone" :persistent="busy || Boolean(drafting)" @update:model-value="close">
    <div
      class="mb-ctemp"
      :class="{ 'mb-ctemp--phone': phone }"
      role="dialog"
      aria-labelledby="mb-ctemp-title"
      @keydown="onKeydown"
    >
      <div class="mb-ctemp__head">
        <button v-if="phone" type="button" class="mb-ctemp__close" aria-label="Close" :disabled="busy" @click="close">
          <v-icon icon="$close" size="18" />
        </button>
        <h2 id="mb-ctemp-title" class="mb-ctemp__title">Change {{ bot.name }}'s template</h2>
        <button
          v-if="phone && chosen"
          type="button"
          class="mb-ctemp__button mb-ctemp__button--primary mb-ctemp__action"
          :disabled="!canChange"
          @click="change"
        >
          {{ busy ? "Changing…" : "Change" }}
        </button>
        <button v-if="!phone" type="button" class="mb-ctemp__close" aria-label="Close" :disabled="busy" @click="close">
          <v-icon icon="$close" size="14" />
        </button>
      </div>

      <div class="mb-ctemp__body">
        <div class="mb-ctemp__picker" :class="{ 'mb-ctemp__picker--behind': chosen || drafting }" :inert="Boolean(chosen || drafting)">
          <TemplateBrowser ref="browser" class="mb-ctemp__browser" picking :home="home || []" @pick="pick" />
          <div class="mb-ctemp__foot mb-ctemp__picker-foot">
            <span class="mb-ctemp__hint">Nothing that fits?</span>
            <button type="button" class="mb-ctemp__button" @click="startDraft('from-bot')"><v-icon icon="$forkRight" size="15" /> Start from this bot</button>
            <button type="button" class="mb-ctemp__button" @click="startDraft('new')"><v-icon icon="$editSquare" size="15" /> Make a new template</button>
          </div>
        </div>
        <Transition name="mb-ctemp-step">
          <div v-if="drafting" class="mb-ctemp__step">
            <button type="button" class="mb-ctemp__step-link mb-ctemp__draft-back" :disabled="busy" @click="toPicker">
              <v-icon icon="$chevronLeft" size="16" /> All templates
            </button>
            <MercbotTemplateDraft
              ref="draftScreen"
              class="mb-ctemp__draft"
              :purpose="drafting"
              :bot="bot"
              :additions="additions"
              :home-tags="homeTags"
              save-label="Save and use"
              :saving="busy"
              :save-error="problem"
              :save-problems="saveProblems"
              @save="saveDraft"
            />
          </div>
        </Transition>
        <Transition name="mb-ctemp-step">
          <div v-if="chosen" class="mb-ctemp__step">
            <div class="mb-ctemp__scroll">
              <button ref="back" type="button" class="mb-ctemp__step-link" :disabled="busy" @click="toPicker">
                <v-icon icon="$chevronLeft" size="16" /> All templates
              </button>
              <div v-if="loadFailed" class="mb-ctemp__state" role="alert">
                <p>That template couldn't be loaded.</p>
                <button type="button" class="mb-set-pill" @click="pick(chosen)">Try again</button>
              </div>
              <div v-else-if="!detail" class="mb-ctemp__state" role="status" aria-label="Loading the template" />
              <template v-else>
                <div class="mb-ctemp__who">
                  <TemplateAvatar v-if="library" :template="detail" :size="56" />
                  <span v-else class="mb-ctemp__home-face"><v-icon icon="$home" size="26" /></span>
                  <div class="mb-ctemp__who-text">
                    <h3 class="mb-ctemp__name">
                      {{ library ? detail.name : detail.tag }}
                      <MercbotTemplateTag :bot="chosenTag" size="medium" :tooltip="false" />
                    </h3>
                    <p class="mb-ctemp__by">
                      {{ library ? `Mercbot's library, by ${detail.creator}` : `Your home's template · ${detail.usedBy === 1 ? "used by 1 bot" : `used by ${detail.usedBy} bots`}` }}
                      <TemplateTested v-if="library && detail.team" :template="detail" />
                    </p>
                  </div>
                </div>
                <p class="mb-ctemp__description">{{ detail.description }}</p>
                <p v-if="current" class="mb-ctemp__note mb-ctemp__note--now">This is {{ bot.name }}'s template now.</p>

                <p class="mb-ctemp__label"><v-icon icon="$lock" size="13" /> Its instructions</p>
                <div class="mb-ctemp__text">{{ detail.instructions }}</div>
                <template v-if="detail.skills?.length">
                  <p class="mb-ctemp__label">Its skills</p>
                  <ul class="mb-ctemp__skills">
                    <li v-for="skill in detail.skills" :key="skill.name"><strong>{{ skill.name }}</strong> {{ skill.description }}</li>
                  </ul>
                </template>

                <p class="mb-ctemp__label">{{ bot.name }}'s additions stay</p>
                <div class="mb-ctemp__text" :class="{ 'mb-ctemp__text--none': !additions }">{{ additions || "Nothing added." }}</div>
                <p class="mb-ctemp__note">
                  {{ additions ? `They now sit under ${detail.tag}, still for ${bot.name} alone, and you can change them in its Instructions.` : "" }}
                  {{ bot.name }} keeps its name, look, chats and routines, and asks the new template's setup questions in your chat with it.
                </p>
              </template>
            </div>
            <p v-if="problem" class="mb-ctemp__error" role="alert">{{ problem }}</p>
            <div v-if="!phone" class="mb-ctemp__foot">
              <button type="button" class="mb-ctemp__button" :disabled="busy" @click="toPicker">Back</button>
              <button type="button" class="mb-ctemp__button mb-ctemp__button--primary" :disabled="!canChange" @click="change">
                {{ busy ? "Changing…" : "Change template" }}
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
