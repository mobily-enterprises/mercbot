<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import { TEMPLATE_LIMITS } from "@local/bots/shared/templateBody";
import { templatesApi } from "../templates/templatesApi.js";
import { botsApi } from "./botsApi.js";
import { diffExcerpt, partOf, useTemplateDraft, wordDiff } from "./templateDraft.js";

// The one draft screen (D-98, amended 20 November) for Make a new template, Start from this bot and Settings →
// Templates → Edit: a sentence to Draft it from (making new), or the bot's own draft at once (from a bot); then the
// whole template, every part editable by hand and checked as the server checks it, problems at their parts; Ask for
// changes, one call each with the whole draft, what changed highlighted and Undo back through the drafts before, on
// this page only. Save is the dialog's to name ("Save and use", "Save"), and stays off while there are problems.
const props = defineProps({
  purpose: { type: String, required: true, validator: (value) => ["new", "from-bot", "edit"].includes(value) },
  // From a bot: the bot ({ id, name }) and its additions, which the tick box folds in.
  bot: { type: Object, default: null },
  additions: { type: String, default: "" },
  // Editing: the template as it is, and its id.
  start: { type: Object, default: null },
  templateId: { type: String, default: null },
  // The tags the home's other templates have; Mercbot's library's are read here.
  homeTags: { type: Array, default: () => [] },
  saveLabel: { type: String, required: true },
  saving: { type: Boolean, default: false },
  saveError: { type: String, default: "" },
  // A save's problems, as the server refused it with them.
  saveProblems: { type: Array, default: () => [] }
});
const emit = defineEmits(["save"]);

const libraryTags = ref(["general"]);
const state = useTemplateDraft({
  ask: botsApi.draftTemplate,
  taken: () => [...libraryTags.value, ...props.homeTags],
  start: props.start,
  templateId: props.templateId
});
const { draft, earlier, asking, failure, changes, problemsAt, setupIndex, canSave } = state;
const describe = ref("");
const request = ref("");
const fold = ref(false);
const describeInput = ref(null);
const top = ref(null);

watch(() => props.saveProblems, (list) => state.refuse(list));

onMounted(() => {
  templatesApi.gallery().then(({ templates }) => {
    libraryTags.value = ["general", ...templates.map((template) => template.tag).filter(Boolean)];
  }).catch(() => {});
  if (props.purpose === "from-bot") state.draftFromBot(props.bot.id, false);
  else if (!draft.value) nextTick(() => describeInput.value?.focus());
});

// The template's own parts, then each skill's; long ones show, word by word, what changed.
const PARTS = [
  { path: "tag", label: "Tag", hint: "One lowercase word, 2 to 10 letters or digits, shown beside every bot that uses it.", max: 10 },
  { path: "description", label: "Description", hint: "One line: what a bot with this template does.", max: TEMPLATE_LIMITS.description },
  { path: "greeting", label: "Greeting", hint: "Its first message to a new person. {firstName} becomes their name.", rows: 3, max: TEMPLATE_LIMITS.greeting },
  { path: "instructions", label: "Instructions", hint: "Written to the bot: its job, what to do and not do, and what to ask first.", rows: 10, max: TEMPLATE_LIMITS.instructions }
];
const skillParts = (index) => [
  { path: `skills.${index}.name`, label: "Name", max: TEMPLATE_LIMITS.skillName },
  { path: `skills.${index}.description`, label: "What it's for", max: TEMPLATE_LIMITS.skillDescription },
  { path: `skills.${index}.instructions`, label: "Steps", rows: 5, max: TEMPLATE_LIMITS.skillInstructions }
];
const otherSkills = computed(() => (draft.value ? draft.value.skills.map((_, index) => index).filter((index) => index !== setupIndex.value) : []));
const changeCount = computed(() => (changes.value.size === 1 ? "1 change" : `${changes.value.size} changes`));
const idOf = (path) => `mb-tdraft-${path.replaceAll(".", "-")}`;
/** What changed in a long part since the draft before, word by word, cut short around the changes. */
const diffOf = (path) => diffExcerpt(wordDiff(partOf(earlier.value.at(-1), path), partOf(draft.value, path)));

async function draftIt() {
  if (!describe.value.trim()) return;
  await state.draftNew(describe.value.trim());
  if (top.value) top.value.scrollTop = 0;
}

async function askForChanges() {
  if (!request.value.trim()) return;
  if (await state.askForChanges(request.value.trim())) request.value = "";
}

function foldChanged() {
  state.draftFromBot(props.bot.id, fold.value);
}

function save() {
  if (canSave.value && !props.saving) emit("save", { draft: JSON.parse(JSON.stringify(draft.value)), foldAdditions: fold.value });
}

defineExpose({ dirty: state.dirty });
</script>

<template>
  <div class="mb-tdraft">
    <div ref="top" class="mb-tdraft__scroll">
      <form v-if="purpose === 'new' && !draft" class="mb-tdraft__describe" @submit.prevent="draftIt">
        <label for="mb-tdraft-describe" class="mb-tdraft__question">What will bots with this template do?</label>
        <textarea
          id="mb-tdraft-describe"
          ref="describeInput"
          v-model="describe"
          class="mb-tdraft__input"
          rows="3"
          maxlength="600"
          placeholder="For example: plan our week's dinners around what's in season, and keep the shopping list"
          :disabled="asking"
          @keydown.enter.exact.prevent="draftIt"
        />
        <p class="mb-tdraft__hint">One sentence is enough. Mercbot writes the whole template, and you can change any of it before you save.</p>
        <button type="submit" class="mb-tdraft__button mb-tdraft__button--primary" :disabled="!describe.trim() || asking">{{ asking ? "Drafting…" : "Draft it" }}</button>
      </form>

      <p v-else-if="!draft && asking" class="mb-tdraft__state" role="status">Drafting a template from {{ bot?.name }}…</p>
      <button v-else-if="!draft" type="button" class="mb-tdraft__button" @click="foldChanged">Try again</button>

      <template v-else-if="draft">
        <div class="mb-tdraft__bar">
          <span class="mb-tdraft__count" role="status">{{ earlier.length ? changeCount : "" }}</span>
          <button v-if="earlier.length" type="button" class="mb-tdraft__button" :disabled="asking" @click="state.undo()">Undo</button>
        </div>
        <div v-if="purpose === 'from-bot' && additions" class="mb-tdraft__fold">
          <label><input v-model="fold" type="checkbox" :disabled="asking" @change="foldChanged"> Fold in {{ bot.name }}'s additions</label>
          <p class="mb-tdraft__hint">
            {{ fold ? `They're written into the template, and ${bot.name}'s own additions are emptied when you save.` : `They stay ${bot.name}'s own, on top of the new template.` }}
          </p>
        </div>

        <div v-for="part in PARTS" :key="part.path" class="mb-tdraft__field" :class="{ 'mb-tdraft__field--changed': changes.has(part.path) }">
          <label :for="idOf(part.path)" class="mb-tdraft__label">{{ part.label }}</label>
          <component
            :is="part.rows ? 'textarea' : 'input'"
            :id="idOf(part.path)"
            class="mb-tdraft__input"
            :rows="part.rows"
            :value="partOf(draft, part.path)"
            :aria-invalid="problemsAt.has(part.path)"
            :aria-describedby="`${idOf(part.path)}-hint`"
            :disabled="asking"
            @input="state.edit(part.path, $event.target.value)"
          />
          <p :id="`${idOf(part.path)}-hint`" class="mb-tdraft__hint">
            <span v-if="problemsAt.get(part.path)" class="mb-tdraft__problem">{{ problemsAt.get(part.path) }}</span>
            <template v-else>{{ part.hint }}</template>
          </p>
          <p v-if="part.rows && changes.has(part.path)" class="mb-tdraft__diff" :aria-label="`What changed in ${part.label}`">
            <template v-for="(bit, index) in diffOf(part.path)" :key="index">
              <ins v-if="bit.change === 'added'">{{ bit.text }}</ins><del v-else-if="bit.change === 'removed'">{{ bit.text }}</del><span v-else>{{ bit.text }}</span>
            </template>
          </p>
        </div>

        <section class="mb-tdraft__section" aria-labelledby="mb-tdraft-setup">
          <h3 id="mb-tdraft-setup" class="mb-tdraft__heading">Setup questions</h3>
          <p class="mb-tdraft__hint">What the bot asks a new person, one at a time, before it starts: which accounts to connect, their preferences, which routines to offer.</p>
          <p v-if="problemsAt.get('setup')" class="mb-tdraft__problem" role="alert">{{ problemsAt.get("setup") }}</p>
          <template v-if="setupIndex >= 0">
            <div
              v-for="part in skillParts(setupIndex).slice(1)"
              :key="part.path"
              class="mb-tdraft__field"
              :class="{ 'mb-tdraft__field--changed': changes.has(part.path) }"
            >
              <label :for="idOf(part.path)" class="mb-tdraft__label">{{ part.rows ? "Setup questions" : "What they're for" }}</label>
              <component
                :is="part.rows ? 'textarea' : 'input'"
                :id="idOf(part.path)"
                class="mb-tdraft__input"
                :rows="part.rows"
                :value="partOf(draft, part.path)"
                :aria-invalid="problemsAt.has(part.path)"
                :disabled="asking"
                @input="state.edit(part.path, $event.target.value)"
              />
              <p v-if="problemsAt.get(part.path)" class="mb-tdraft__hint"><span class="mb-tdraft__problem">{{ problemsAt.get(part.path) }}</span></p>
              <p v-if="part.rows && changes.has(part.path)" class="mb-tdraft__diff" aria-label="What changed in Setup questions">
                <template v-for="(bit, index) in diffOf(part.path)" :key="index">
                  <ins v-if="bit.change === 'added'">{{ bit.text }}</ins><del v-else-if="bit.change === 'removed'">{{ bit.text }}</del><span v-else>{{ bit.text }}</span>
                </template>
              </p>
            </div>
          </template>
          <button v-else type="button" class="mb-tdraft__button" :disabled="asking" @click="state.addSkill({ setup: true })">Add setup questions</button>
        </section>

        <section class="mb-tdraft__section" aria-labelledby="mb-tdraft-skills">
          <h3 id="mb-tdraft-skills" class="mb-tdraft__heading">Other skills</h3>
          <p v-if="problemsAt.get('skills')" class="mb-tdraft__problem" role="alert">{{ problemsAt.get("skills") }}</p>
          <div v-for="(index, position) in otherSkills" :key="index" class="mb-tdraft__skill" :aria-label="`Skill ${position + 1}`" role="group">
            <div
              v-for="part in skillParts(index)"
              :key="part.path"
              class="mb-tdraft__field"
              :class="{ 'mb-tdraft__field--changed': changes.has(part.path) }"
            >
              <label :for="idOf(part.path)" class="mb-tdraft__label">{{ part.label }}</label>
              <component
                :is="part.rows ? 'textarea' : 'input'"
                :id="idOf(part.path)"
                class="mb-tdraft__input"
                :rows="part.rows"
                :value="partOf(draft, part.path)"
                :aria-invalid="problemsAt.has(part.path)"
                :disabled="asking"
                @input="state.edit(part.path, $event.target.value)"
              />
              <p v-if="problemsAt.get(part.path)" class="mb-tdraft__hint"><span class="mb-tdraft__problem">{{ problemsAt.get(part.path) }}</span></p>
            </div>
            <button type="button" class="mb-tdraft__link" :disabled="asking" @click="state.removeSkill(index)">Remove this skill</button>
          </div>
          <button v-if="draft.skills.length < TEMPLATE_LIMITS.skills" type="button" class="mb-tdraft__button" :disabled="asking" @click="state.addSkill()">Add a skill</button>
        </section>

        <form class="mb-tdraft__ask" @submit.prevent="askForChanges">
          <label for="mb-tdraft-request" class="mb-tdraft__question">Ask for changes</label>
          <textarea
            id="mb-tdraft-request"
            v-model="request"
            class="mb-tdraft__input"
            rows="2"
            maxlength="2000"
            aria-label="What should change?"
            placeholder="For example: also plan lunches, and keep the shopping list by aisle"
            :disabled="asking"
          />
          <button type="submit" class="mb-tdraft__button" :disabled="!request.trim() || asking">{{ asking ? "Changing…" : "Ask for changes" }}</button>
        </form>
      </template>
      <p v-if="failure" class="mb-tdraft__problem mb-tdraft__failure" role="alert">{{ failure }}</p>
    </div>
    <div v-if="draft" class="mb-tdraft__foot">
      <p v-if="saveError" class="mb-tdraft__problem" role="alert">{{ saveError }}</p>
      <button type="button" class="mb-tdraft__button mb-tdraft__button--primary" :disabled="!canSave || saving" @click="save">{{ saving ? "Saving…" : saveLabel }}</button>
    </div>
  </div>
</template>

<style scoped src="./MercbotTemplateDraft.css"></style>
