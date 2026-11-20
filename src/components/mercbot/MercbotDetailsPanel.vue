<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useHomes } from "./homesApi.js";
import MercbotFileViewer from "./MercbotFileViewer.vue";
import MercbotAppsSection from "../apps/MercbotAppsSection.vue";
import FileBrowser from "../files/FileBrowser.vue";
import MercbotPageShare from "./MercbotPageShare.vue";
import MercbotViewViewer from "@/components/apps/MercbotViewViewer.vue";
import { fileUrl } from "./filesApi.js";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotConvoAvatar from "./MercbotConvoAvatar.vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotContextMenu from "./MercbotContextMenu.vue";
import MercbotIconButton from "./MercbotIconButton.vue";
import MercbotVncScreen from "./MercbotVncScreen.vue";
import extensions from "./extensions.js";
import { computerApi, useComputerStream } from "./computerApi.js";
import { emitResizeDrag } from "./pointerDrag.js";
import { shellPreferences } from "./shellPreferences.js";
import { itemAge, itemIcon, itemMeta, itemType, pageAccess, useBotLibrary } from "./useBotLibrary.js";
import { noteAge, useBotNotebook } from "./useBotNotebook.js";
import { useBotRoutines } from "./useBotRoutines.js";
import { useBotInstructions } from "./useBotInstructions.js";
import MercbotTemplateTag from "./MercbotTemplateTag.vue";
import MercbotChangeTemplateDialog from "./MercbotChangeTemplateDialog.vue";
import { dayText } from "../templates/templatesApi.js";
import { useGroupMembers } from "./useGroupMembers.js";
import { COMPUTER_GREY } from "@/theme/palettes.js";

// Bot details panel: header with its editable name and its template's tag (D-98), then its tabs.
const props = defineProps({
  width: { type: Number, required: true },
  bot: { type: Object, required: true },
  mood: { type: String, default: "idle" },
  // Every bot, for adding members to a group.
  allBots: { type: Array, default: () => [] },
  // The person looking, for what they may do with a group's people (D-46), and their name, for a page's Share.
  me: { type: String, default: "" },
  displayName: { type: String, default: "" }
});
const emit = defineEmits([
  "close", "resize", "rename", "changed", "failure", "notify", "messages", "open-computer", "edit-routine", "add-member",
  "remove-member", "add-person", "remove-person", "sharing", "keep-out", "open-page"
]);

// Who sees what (D-36): owners and admins choose; everyone else sees the choice.
const { current: home, manages } = useHomes();
const SHARING = computed(() => [
  { value: "private", title: "Private", text: `Each person's chats with ${props.bot.name} are their own.` },
  { value: "mixed", title: "Mixed", text: `Chats are private. What helps everyone goes in ${home.value?.name || "the home"}'s notebook, which everyone can read.` },
  { value: "shared", title: "Shared", text: `Everyone in ${home.value?.name || "this home"} talks with ${props.bot.name} in named conversations they all see.` }
]);

const TABS = [
  { value: "details", title: "Details" },
  { value: "files", title: "Files" },
  { value: "library", title: "Library" },
  { value: "computer", title: "Computer" }
];

// A group has Details, Library and Members; a bot has Details, Files, Library and Computer (D-47).
const isGroup = computed(() => props.bot.kind === "group");
const tabs = computed(() => (isGroup.value
  ? [TABS[0], TABS[2], { value: "members", title: "Members" }]
  : TABS));
const tab = computed(() => {
  const chosen = shellPreferences.detailsTab;
  if (isGroup.value && (chosen === "computer" || chosen === "files")) return "details";
  if (!isGroup.value && chosen === "members") return "details";
  return chosen;
});

const { members, pendingRemoval, memberSearch, addOpen, addable, addMember, people, personOpen, pendingPerson, canRemove, addablePeople, addPerson } =
  useGroupMembers({
    bot: () => props.bot,
    allBots: () => props.allBots,
    me: () => props.me,
    home,
    manages,
    onAddMember: (bot) => emit("add-member", bot),
    onAddPerson: (person) => emit("add-person", person),
    onFailure: (error) => emit("failure", error)
  });

const initialsOf = (name) => String(name || "?").split(/\s+/u).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

// Inline editing of the name: Enter or leaving the field saves, Escape cancels.
const editing = ref("");
const editValue = ref("");
const editInput = ref(null);

async function startEdit(field) {
  editing.value = field;
  editValue.value = props.bot.name;
  await nextTick();
  editInput.value?.focus();
  editInput.value?.select();
}

function commitEdit() {
  const field = editing.value;
  if (!field) return;
  editing.value = "";
  const value = editValue.value.trim();
  if (field === "name" && value && value !== props.bot.name) emit("rename", value);
}

function onEditKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    commitEdit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    editing.value = "";
  }
}

const { libraryItems, libraryLoaded, expandedDays, openItem, libraryGroups, sharingItem, pendingDelete, itemMenu, openItemMenu, deletePage } =
  useBotLibrary({
    bot: () => props.bot,
    isGroup,
    tab,
    onFailure: (error) => emit("failure", error),
    onMessages: (changed) => emit("messages", changed)
  });
// A Library entry's hover card: when it was made, and for a page who can open it (pageAccess).
const madeAt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const accessOf = (item) => pageAccess(props.bot, item.path, home.value?.name);
const sharingOpen = computed({ get: () => Boolean(sharingItem.value), set: (value) => { if (!value) sharingItem.value = null; } });
// A page opens in place of the chat (D-74), from its row or its menu's Open.
watch(openItem, (item) => {
  if (item?.kind !== "page") return;
  openItem.value = null;
  emit("open-page", { path: item.path, botId: String(props.bot.id) });
});
const { notes, notesLoaded, notesNext, moreNotes, removeNote } = useBotNotebook({ bot: () => props.bot, isGroup, tab, onFailure: (error) => emit("failure", error) });

// Computer tab: asleep until clicked, then waking, then a live thumbnail.
const computerTab = computed(() => tab.value === "computer");
const { state: computerState, error: computerError } = useComputerStream(computed(() => props.bot.id), computerTab);

function wakeComputer() {
  if (computerState.value === "asleep") {
    computerState.value = "waking";
    computerApi.wake(props.bot.id).catch((error) => emit("failure", error));
  }
}

watch(() => props.bot.id, () => {
  editing.value = "";
}, { immediate: true });

const { routines, routinesLoaded, toggleRoutine, highlightedRoutineId, routineMenu, pendingRoutineDelete, openRoutineMenu, deleteRoutine } =
  useBotRoutines({ bot: () => props.bot, tab, onEdit: (routine) => emit("edit-routine", routine), onFailure: (error) => emit("failure", error) });

// Its Instructions (D-98): the template it points at, read-only, and its own additions, which its maker and the home's
// owners and admins edit here; they also change its template.
const {
  instructions, loadInstructions, editingAdditions, additionsDraft, savingAdditions, additionsProblem, additionsBox, additionsChanged,
  editAdditions, cancelAdditions, saveAdditions
} = useBotInstructions({
  bot: () => props.bot,
  isGroup,
  tab,
  onSaved: (bot) => {
    emit("changed", bot);
    emit("notify", "Additions saved");
  },
  onFailure: (error) => emit("failure", error)
});
const template = computed(() => instructions.value?.template || null);
const article = computed(() => (/^[aeiou]/u.test(props.bot.template?.tag || "") ? "an" : "a"));
const templateSource = computed(() => {
  if (!template.value) return "";
  if (template.value.source === "home") return "Your home's template";
  return `Mercbot's library${template.value.tested ? ` · Tested ${dayText(template.value.tested)}` : ""}`;
});
const changedLine = computed(() => {
  const changed = template.value?.changed;
  return changed ? `Changed ${dayText(String(changed.date).slice(0, 10))}: ${changed.text}` : "";
});
// Long instructions show their first lines until opened out.
const allShown = ref(false);
const longTemplate = computed(() => (template.value?.instructions || "").length > 420 || (template.value?.instructions || "").split("\n").length > 7);
const additionsHint = "Rules for this bot alone, on top of its template: how you like things done and what to avoid. It reads these before every reply.";
const additionsNote = computed(() =>
  instructions.value && !instructions.value.canChange ? `The person who made ${props.bot.name} and the home's owners and admins change these.` : "");
const changeOpen = ref(false);
function templateChanged(bot) {
  emit("changed", bot);
  emit("notify", `${bot.name} is now ${/^[aeiou]/u.test(bot.template?.tag || "") ? "an" : "a"} ${bot.template?.tag || ""} bot`);
  allShown.value = false;
  loadInstructions();
}
// Its tag in the header opens its Instructions: the Details tab, scrolled to them.
const instructionsSection = ref(null);
async function openInstructions() {
  shellPreferences.detailsTab = "details";
  await nextTick();
  instructionsSection.value?.scrollIntoView({ block: "start" });
  instructionsSection.value?.focus({ preventScroll: true });
}
</script>

<template>
  <aside class="mb-details" :style="{ width: `${width}px` }" aria-label="Details">
    <div class="mb-details__top">
      <!-- What a copy built on Mercbot adds for a bot (extensions.js). -->
      <template v-if="!isGroup">
        <component :is="action.component" v-for="(action, at) in extensions.botActions" :key="at" :bot="bot" />
      </template>
      <MercbotIconButton icon="$close" label="Close details" @click="emit('close')" />
    </div>

    <div class="mb-details__head">
      <div class="mb-details__avatar"><MercbotConvoAvatar :bot="bot" :size="bot.kind === 'group' ? 64 : 58" :state="mood" /></div>
      <input
        v-if="editing === 'name'"
        ref="editInput"
        v-model="editValue"
        class="mb-details__field mb-details__field--name"
        aria-label="Bot name"
        maxlength="80"
        @keydown="onEditKeydown"
        @blur="commitEdit"
      >
      <button v-else type="button" class="mb-details__name" @click="startEdit('name')">{{ bot.name }}</button>
      <MercbotTemplateTag v-if="!isGroup" :bot="bot" size="medium" action class="mb-details__tag" @open="openInstructions" />
    </div>

    <div class="mb-details__tabs" role="tablist" aria-label="Details sections">
      <button
        v-for="entry in tabs"
        :key="entry.value"
        type="button"
        role="tab"
        class="mb-details__tab"
        :class="{ 'mb-details__tab--selected': tab === entry.value }"
        :aria-selected="tab === entry.value"
        @click="shellPreferences.detailsTab = entry.value"
      >
        {{ entry.title }}
      </button>
    </div>

    <div class="mb-details__content" role="tabpanel">
      <p v-if="tab === 'details' && isGroup" class="mb-details__empty">
        Routines are jobs a bot repeats on a schedule. Set them up in one of your bots' own chats.
      </p>

      <!-- The bot's files (D-47): the person's own with it, the bot's for everyone, the home's. -->
      <FileBrowser
        v-else-if="tab === 'files'"
        :key="bot.id"
        :bot-id="bot.id"
        :refresh-key="bot.lastActivityAt || 0"
        :sections="[
          ...(bot.sharing === 'shared' ? [] : [{ key: 'mine', label: 'Just me', root: '/files/mine' }]),
          { key: 'bot', label: `Everyone using ${bot.name}`, root: '/files/bot' },
          { key: 'shared', label: home?.name || 'Whole home', root: '/files/shared' }
        ]"
      />

      <template v-else-if="tab === 'members'">
        <p class="mb-members__heading">People</p>
        <ul class="mb-members">
          <li v-for="person in people" :key="person.id" class="mb-member">
            <span class="mb-member__initials" aria-hidden="true">{{ initialsOf(person.name) }}</span>
            <span class="mb-member__name">{{ person.name }}{{ person.id === me ? " (you)" : "" }}</span>
            <button v-if="person.id === me" type="button" class="mb-member__remove" @click="pendingPerson = person">Leave</button>
            <button v-else-if="canRemove(person)" type="button" class="mb-member__remove" :aria-label="`Remove ${person.name}`" @click="pendingPerson = person">Remove</button>
          </li>
        </ul>
        <v-menu v-model="personOpen" location="bottom start" :offset="4" content-class="mb-popover" :close-on-content-click="false">
          <template #activator="{ props: personProps }">
            <button v-bind="personProps" type="button" class="mb-member mb-member--add">
              <span class="mb-member__plus"><v-icon icon="$add" size="14" /></span>
              <span class="mb-member__name">Add a person</span>
            </button>
          </template>
          <div class="mb-add-member">
            <button v-for="candidate in addablePeople" :key="candidate.id" type="button" class="mb-add-member__row" @click="addPerson(candidate)">
              <span class="mb-member__initials" aria-hidden="true">{{ initialsOf(candidate.name) }}</span>
              <span class="mb-member__name">{{ candidate.name }}</span>
            </button>
            <p v-if="!addablePeople.length" class="mb-add-member__empty">Everyone in {{ home?.name || "this home" }} is here</p>
          </div>
        </v-menu>
        <MercbotConfirmDialog
          :model-value="Boolean(pendingPerson)"
          :title="pendingPerson?.id === me ? (people.length === 1 ? 'Leave and delete this group?' : 'Leave this group?') : `Remove ${pendingPerson?.name} from this group?`"
          :confirm-label="pendingPerson?.id === me ? 'Leave' : 'Remove'"
          dim
          @update:model-value="pendingPerson = null"
          @confirm="emit('remove-person', pendingPerson)"
        />

        <p class="mb-members__heading">Bots</p>
        <ul class="mb-members">
          <li v-for="member in members" :key="member.id" class="mb-member">
            <MercbotAvatar :bot="member" :size="24" still />
            <span class="mb-member__name">{{ member.name }}</span>
            <!-- The last bot can't be removed: its Remove shows faded and does nothing. -->
            <button
              type="button"
              class="mb-member__remove"
              :class="{ 'mb-member__remove--inert': members.length < 2 }"
              :aria-label="`Remove ${member.name}`"
              :aria-disabled="members.length < 2"
              @click="members.length > 1 && (pendingRemoval = member)"
            >
              Remove
            </button>
          </li>
        </ul>
        <v-menu v-model="addOpen" location="bottom start" :offset="4" content-class="mb-popover" :close-on-content-click="false">
          <template #activator="{ props: addProps }">
            <button v-bind="addProps" type="button" class="mb-member mb-member--add" :disabled="members.length >= 6">
              <span class="mb-member__plus"><v-icon icon="$add" size="14" /></span>
              <span class="mb-member__name">{{ members.length >= 6 ? "The group is full" : "Add a bot" }}</span>
            </button>
          </template>
          <div class="mb-add-member">
            <input v-model="memberSearch" class="mb-add-member__search" placeholder="Search bots" aria-label="Search bots">
            <button v-for="candidate in addable" :key="candidate.id" type="button" class="mb-add-member__row" @click="addMember(candidate)">
              <MercbotAvatar :bot="candidate" :size="20" still />
              <span class="mb-member__name">{{ candidate.name }}</span>
              <MercbotTemplateTag :bot="candidate" :tooltip="false" />
            </button>
            <p v-if="!addable.length" class="mb-add-member__empty">No other bots to add</p>
          </div>
        </v-menu>
        <MercbotConfirmDialog
          :model-value="Boolean(pendingRemoval)"
          :title="`Remove ${pendingRemoval?.name} from this conversation?`"
          confirm-label="Remove"
          dim
          @update:model-value="pendingRemoval = null"
          @confirm="emit('remove-member', pendingRemoval)"
        />
      </template>

      <template v-else-if="tab === 'details'">
        <!-- Its Instructions (D-98): one sentence, its template read-only, its own additions. First, as what it is. -->
        <section
          v-if="!isGroup && instructions"
          ref="instructionsSection"
          class="mb-instructions-section"
          tabindex="-1"
          aria-labelledby="mb-instructions-title"
        >
          <p id="mb-instructions-title" class="mb-details__section mb-instructions__label">Instructions</p>
          <p v-if="template" class="mb-instructions__sentence">
            This bot is {{ article }} <MercbotTemplateTag :bot="{ ...bot, hasAdditions: false }" :tooltip="false" /> bot{{
              instructions.additions ? ", plus its own additions." : ", with nothing added yet." }}
          </p>
          <p v-else class="mb-instructions__sentence">This bot has no template yet.</p>

          <div v-if="template" class="mb-instructions__template">
            <div class="mb-instructions__box-head">
              <span class="mb-instructions__box-title">Template <span class="mb-instructions__tag">{{ template.tag }}</span></span>
              <v-icon icon="$lock" size="14" class="mb-instructions__lock" aria-label="Read-only: the bot never changes it" />
            </div>
            <p class="mb-instructions__source">
              <v-icon v-if="template.source === 'library'" icon="$cloud" size="12" class="mb-instructions__cloud" />
              <v-icon v-else icon="$home" size="13" />
              {{ templateSource }}
            </p>
            <p v-if="changedLine" class="mb-instructions__changed">{{ changedLine }}</p>
            <p class="mb-instructions__text" :class="{ 'mb-instructions__text--clamped': longTemplate && !allShown }">{{ template.instructions }}</p>
            <button v-if="longTemplate" type="button" class="mb-instructions__more" @click="allShown = !allShown">
              {{ allShown ? "Show less" : "Show all" }}
            </button>
            <p v-if="template.skills.length" class="mb-instructions__skills">
              Skills: {{ template.skills.map((skill) => skill.name).join(", ") }}
            </p>
            <div v-if="instructions.canChange" class="mb-instructions__actions">
              <button type="button" class="mb-set-pill" @click="changeOpen = true">
                <v-icon icon="$swapHoriz" size="16" /> Change template
              </button>
            </div>
          </div>
          <div v-else-if="instructions.canChange" class="mb-instructions__actions mb-instructions__actions--start">
            <button type="button" class="mb-set-pill" @click="changeOpen = true">Choose a template</button>
          </div>

          <p class="mb-instructions__box-label">Additions · only this bot</p>
          <div v-if="editingAdditions" class="mb-instructions">
            <textarea
              ref="additionsBox"
              v-model="additionsDraft"
              class="mb-instructions__box"
              aria-label="Additions"
              rows="8"
              :placeholder="additionsHint"
              :disabled="savingAdditions"
              @keydown.esc.stop.prevent="cancelAdditions"
            />
            <p v-if="additionsProblem" class="mb-instructions__problem" role="alert">{{ additionsProblem }}</p>
            <div class="mb-instructions__actions">
              <button type="button" class="mb-set-pill" :disabled="savingAdditions" @click="cancelAdditions">Cancel</button>
              <button type="button" class="mb-set-pill mb-set-pill--dark" :disabled="savingAdditions || !additionsChanged" @click="saveAdditions">
                {{ savingAdditions ? "Saving…" : "Save" }}
              </button>
            </div>
          </div>
          <button
            v-else
            type="button"
            class="mb-sharing mb-instructions__shown"
            :aria-label="instructions.canChange ? 'Edit additions' : 'Additions'"
            :disabled="!instructions.canChange"
            @click="editAdditions"
          >
            <span v-if="instructions.additions" class="mb-instructions__text mb-instructions__text--clamped">{{ instructions.additions }}</span>
            <span v-else class="mb-sharing__description">Nothing added. Tweaks here apply only to this bot.</span>
          </button>
          <p v-if="additionsNote && !editingAdditions" class="mb-sharing__note">{{ additionsNote }}</p>
        </section>
        <MercbotChangeTemplateDialog
          v-if="!isGroup"
          v-model="changeOpen"
          :bot="bot"
          :additions="instructions?.additions || ''"
          @changed="templateChanged"
        />
        <MercbotAppsSection v-if="!isGroup" :bot="bot" />

        <p class="mb-details__section">Who sees what</p>
        <div class="mb-sharing" role="radiogroup" aria-label="Who sees what">
          <button
            v-for="option in SHARING"
            :key="option.value"
            type="button"
            role="radio"
            class="mb-sharing__option"
            :aria-checked="bot.sharing === option.value"
            :disabled="!manages"
            @click="bot.sharing !== option.value && emit('sharing', option.value)"
          >
            <span class="mb-sharing__text">
              <span class="mb-sharing__title">
                {{ option.title }}
                <v-icon v-if="option.value === 'shared'" icon="$group" size="13" />
              </span>
              <span class="mb-sharing__description">{{ option.text }}</span>
            </span>
            <v-icon v-if="bot.sharing === option.value" icon="$check" size="16" class="mb-sharing__check" />
          </button>
        </div>
        <p v-if="!manages" class="mb-sharing__note">The home's owners and admins choose this.</p>

        <template v-if="bot.sharing === 'mixed'">
          <p class="mb-details__section">{{ home?.name || "Home" }} notebook</p>
          <div class="mb-sharing mb-notebook">
            <div v-if="!notesLoaded" class="mb-details__skeleton" aria-hidden="true" />
            <p v-else-if="!notes.length" class="mb-notebook__empty">
              Nothing noted yet. When {{ bot.name }} learns something in a chat that helps everyone here, it notes it and says so in one line.
            </p>
            <div v-for="note in notes" :key="note.id" class="mb-notebook__note">
              <span class="mb-sharing__text">
                <span class="mb-notebook__text">{{ note.text }}</span>
                <span class="mb-sharing__description">From {{ note.author }} · {{ noteAge(note.createdAt) }}</span>
              </span>
              <MercbotIconButton v-if="note.canRemove" icon="$close" :label="`Remove “${note.text}”`" tooltip="Remove" size="x-small" :icon-size="14" tone="bare" @click="removeNote(note)" />
            </div>
            <button v-if="notesNext" type="button" class="mb-notebook__more" @click="moreNotes">Show more</button>
            <div class="mb-notebook__keep">
              <span class="mb-sharing__description">Keep my chats with {{ bot.name }} out of it</span>
              <button
                type="button"
                role="switch"
                class="mb-switch"
                :class="{ 'mb-switch--on': bot.keepOutOfNotebook }"
                :aria-checked="bot.keepOutOfNotebook"
                aria-label="Keep my chats out of the notebook"
                @click="emit('keep-out', !bot.keepOutOfNotebook)"
              >
                <span class="mb-switch__knob" />
              </button>
            </div>
          </div>
        </template>

        <template v-if="routinesLoaded && routines.length">
          <p class="mb-details__section">Routines</p>
          <div class="mb-routines">
            <div
              v-for="routine in routines"
              :key="routine.id"
              class="mb-routine"
              :class="{ 'mb-routine--highlighted': highlightedRoutineId === routine.id }"
              @click="highlightedRoutineId = routine.id"
              @contextmenu.prevent="openRoutineMenu($event, routine)"
            >
              <span class="mb-routine__text">
                <span class="mb-routine__name">{{ routine.name }}</span>
                <span class="mb-routine__schedule">{{ routine.enabled ? routine.schedule : "Paused" }}</span>
              </span>
              <button
                type="button"
                role="switch"
                class="mb-switch"
                :class="{ 'mb-switch--on': routine.enabled }"
                :aria-checked="routine.enabled"
                :aria-label="`${routine.name} on or off`"
                @click.stop="toggleRoutine(routine)"
              >
                <span class="mb-switch__knob" />
              </button>
            </div>
          </div>
          <MercbotContextMenu v-model="routineMenu.open" :target="routineMenu.target" :items="routineMenu.items" />
          <MercbotConfirmDialog
            :model-value="Boolean(pendingRoutineDelete)"
            :title="`Delete ${pendingRoutineDelete?.name}?`"
            text="Deleting it stops all future runs. This can't be undone."
            @update:model-value="pendingRoutineDelete = null"
            @confirm="deleteRoutine"
          />
        </template>
        <div v-else-if="!routinesLoaded" class="mb-details__skeleton" aria-hidden="true" />
        <p v-else class="mb-details__empty">
          Routines are jobs {{ bot.name }} repeats on a schedule. Ask in the chat to set one up, for example a weekly summary.
        </p>
      </template>

      <template v-else-if="tab === 'library'">
        <div v-if="!isGroup && libraryItems.length" class="mb-library">
          <section v-for="group in libraryGroups" :key="group.label" class="mb-library__group">
            <p class="mb-library__day">{{ group.label }}</p>
            <!-- Hovering a row shows its card above it. -->
            <v-tooltip v-for="item in group.shown" :key="item.path" location="top start" :offset="2" :open-delay="450" content-class="mb-hover-card">
              <template #activator="{ props: cardProps }">
                <div v-bind="cardProps" class="mb-library__row" @contextmenu.prevent="openItemMenu($event, item)">
                  <button type="button" class="mb-library__open" :aria-label="`Open ${item.name}`" @click="openItem = item">
                    <img v-if="item.kind === 'picture'" class="mb-library__icon mb-library__thumb" :src="fileUrl(bot.id, item.path, { download: false })" alt="">
                    <span v-else class="mb-library__icon"><v-icon :icon="itemIcon(item)" size="18" /></span>
                    <span class="mb-library__text">
                      <span class="mb-library__name">{{ item.name }}</span>
                      <span class="mb-library__meta">{{ itemMeta(item) }}</span>
                    </span>
                    <v-icon v-if="item.pinned" icon="$keepFilled" size="14" class="mb-library__pin" />
                    <span class="mb-library__age">{{ itemAge(item.createdAt) }}</span>
                  </button>
                  <button type="button" class="mb-library__more" :aria-label="`More for ${item.name}`" aria-haspopup="menu" :aria-expanded="itemMenu.open && itemMenu.path === item.path" @click="openItemMenu($event, item)"><v-icon icon="$moreHoriz" size="16" /></button>
                </div>
              </template>
              <span class="mb-hover-card__type">{{ itemType(item) }}</span>
              <span class="mb-hover-card__title">{{ item.name }}</span>
              <span class="mb-hover-card__line"><MercbotConvoAvatar :bot="bot" :size="16" still />{{ bot.name }}</span>
              <span class="mb-hover-card__line">{{ madeAt.format(new Date(item.createdAt)) }}</span>
              <span v-if="item.kind === 'page'" class="mb-hover-card__line"><v-icon :icon="accessOf(item).icon" size="14" />{{ accessOf(item).title }}</span>
            </v-tooltip>
            <button v-if="group.more" type="button" class="mb-library__show-more" @click="expandedDays = new Set([...expandedDays, group.label])">Show more</button>
          </section>
        </div>
        <div v-else-if="!isGroup && !libraryLoaded" class="mb-details__skeleton" aria-hidden="true" />
        <p v-else class="mb-details__empty">
          Anything {{ bot.name }} creates for you, like pages, files and apps, will be kept here.
        </p>
        <MercbotContextMenu v-model="itemMenu.open" :target="itemMenu.target" :items="itemMenu.items" />
        <MercbotPageShare
          v-if="sharingItem"
          v-model="sharingOpen"
          :bot-id="String(bot.id)"
          :path="sharingItem.path"
          :title="sharingItem.name"
          :access="accessOf(sharingItem)"
          :display-name="displayName"
          @copied="emit('notify', $event)"
          @failure="emit('failure', $event)"
        />
        <MercbotConfirmDialog
          :model-value="Boolean(pendingDelete)"
          :title="`Delete “${pendingDelete?.name ?? ''}”?`"
          text="The page is deleted for good, with its ticks. Its cards in the chat stay, marked deleted. This can't be undone."
          @update:model-value="pendingDelete = null"
          @confirm="deletePage"
        />
        <MercbotViewViewer v-if="openItem?.kind === 'view'" :slug="openItem.path" :title="openItem.name" @close="openItem = null" />
        <MercbotFileViewer v-else-if="openItem" :bot-id="String(bot.id)" :file="{ path: openItem.path, name: ['chart', 'picture'].includes(openItem.kind) ? `${openItem.name}.png` : openItem.name }" @close="openItem = null" />
      </template>

      <template v-else>
        <button
          v-if="computerState === 'awake'"
          type="button"
          class="mb-computer mb-computer--live"
          :aria-label="`Open ${bot.name}'s screen`"
          @click="emit('open-computer')"
        >
          <MercbotVncScreen :bot-id="bot.id" awake class="mb-computer__vnc" />
          <span class="mb-computer__open"><v-icon icon="$expandContent" size="14" /> Open</span>
        </button>
        <button
          v-else
          type="button"
          class="mb-computer"
          :disabled="computerState !== 'asleep'"
          @click="wakeComputer"
        >
          <MercbotAvatar :bot="{ ...bot, color: COMPUTER_GREY }" :size="40" :state="computerState === 'asleep' ? 'asleep' : 'attention'" />
          <span class="mb-computer__text" :class="{ 'mb-computer__text--waking': computerState !== 'asleep' }">
            {{ computerState === "asleep" ? "The computer is sleeping. Click to wake it" : "Starting up" }}
          </span>
          <span v-if="computerError" class="mb-computer__error">{{ computerError }}</span>
        </button>
        <p class="mb-computer__caption">{{ bot.name }}'s screen</p>
      </template>
    </div>

    <div
      class="mb-details__resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details"
      @pointerdown.prevent="emitResizeDrag($event, emit)"
    />
  </aside>
</template>

<style scoped src="./MercbotDetailsPanel.css"></style>
<style scoped src="./MercbotDetailsInstructions.css"></style>
