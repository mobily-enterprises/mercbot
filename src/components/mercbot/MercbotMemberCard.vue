<script setup>
import { computed, nextTick, ref, watch } from "vue";
import MercbotAppsSection from "../apps/MercbotAppsSection.vue";
import MercbotViewViewer from "@/components/apps/MercbotViewViewer.vue";
import FileBrowser from "../files/FileBrowser.vue";
import { dayText } from "../templates/templatesApi.js";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotBotArchive from "./MercbotBotArchive.vue";
import MercbotBotMain from "./MercbotBotMain.vue";
import MercbotChangeTemplateDialog from "./MercbotChangeTemplateDialog.vue";
import MercbotChatComputers from "./MercbotChatComputers.vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotContextMenu from "./MercbotContextMenu.vue";
import MercbotFileViewer from "./MercbotFileViewer.vue";
import MercbotKnowledgeSection from "./MercbotKnowledgeSection.vue";
import MercbotMemorySection from "./MercbotMemorySection.vue";
import MercbotPageShare from "./MercbotPageShare.vue";
import MercbotTemplateTag from "./MercbotTemplateTag.vue";
import { leftLine } from "./archiveBot.js";
import { chatTitle, isDirect, kindIcon, kindLabel } from "./chatView.js";
import extensions from "./extensions.js";
import { fileUrl } from "./filesApi.js";
import { shellPreferences } from "./shellPreferences.js";
import { useBotInstructions } from "./useBotInstructions.js";
import { itemAge, itemIcon, itemMeta, itemType, pageAccess, useBotLibrary } from "./useBotLibrary.js";
import { canSwitchRoutine, useBotRoutines } from "./useBotRoutines.js";

// A member's card (D3, plan 4.2), in the shell's Details: a person or a bot of the home, alike. A person: their face,
// name and role, [Message], and the chats you share. A bot: the same, with its editable name, its template and who made
// it, then its sections as tabs: Details (its Instructions, Knowledge, Memory, apps, Routines and Archive), Files (its own folder
// and the home's, and this chat's when the card is opened from one), Library (what it made in the chats you can open)
// and Computer (its computer in this chat, D14 and D16; opened beside another chat, where to find one).
const props = defineProps({
  // { kind: "bot", bot } or { kind: "person", person }.
  member: { type: Object, required: true },
  // The direct chat's row when the card is shown for it, else null (a card opened beside the chat).
  chat: { type: Object, default: null },
  // The person's chat rows, for the chats you share.
  chats: { type: Array, default: () => [] },
  // The person looking.
  me: { type: String, default: "" },
  homeName: { type: String, default: "" },
  // Whether the person is one of the home's owners or admins.
  manages: { type: Boolean, default: false },
  // The bot's face's state, from the open chat.
  mood: { type: String, default: "idle" },
  // The team's bots, so the card shows a bot as the team has it now.
  allBots: { type: Array, default: () => [] },
  // The shell's count per computer ("<chatId> <botId>"), bumped when one changes, for MercbotChatComputers.
  computerNews: { type: Object, default: () => ({}) }
});
const emit = defineEmits([
  "message", "open-chat", "open-page", "changed", "rename", "make-main", "archive-bot", "unarchive-bot", "edit-routine", "messages",
  "open-computer", "failure", "notify"
]);

const TABS = [
  { value: "details", title: "Details" },
  { value: "files", title: "Files" },
  { value: "library", title: "Library" },
  { value: "computer", title: "Computer" }
];
// The bot whose card this is, as the team lists it now, or null for a person.
const bot = computed(() => {
  if (props.member.kind !== "bot") return null;
  const id = String(props.member.bot.id);
  return props.allBots.find((entry) => String(entry.id) === id) || props.member.bot;
});
const person = computed(() => (props.member.kind === "person" ? props.member.person : null));
const isMe = computed(() => Boolean(person.value) && Boolean(props.me) && person.value.id === props.me);
// A person has no sections: nothing of a bot's is read for them.
const tab = computed(() => (bot.value ? shellPreferences.detailsTab : ""));
const NOBODY = Object.freeze({ id: "", name: "" });
const shown = () => bot.value || NOBODY;
const activity = () => props.chat?.lastActivityAt ?? null;
const name = computed(() => bot.value?.name || person.value?.name || "");
const initialsOf = (text) => String(text || "?").split(/\s+/u).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

/** The line under a member's name: a person's role; a bot's maker, or when it left. */
const line = computed(() => {
  if (person.value) return person.value.roleLabel;
  if (bot.value.archivedAt) return leftLine(bot.value);
  if (bot.value.madeBy && String(bot.value.madeBy) === String(props.me)) return "Bot · made by you";
  return bot.value.madeByName ? `Bot · made by ${bot.value.madeByName}` : "Bot";
});
// [Message] opens the chat with the member: never for yourself, a bot that has left, or the direct chat already open.
const canMessage = computed(() => {
  if (person.value) return !isMe.value && String(props.chat?.directPerson?.userId ?? "") !== person.value.id;
  if (bot.value.archivedAt) return false;
  return !(isDirect(props.chat) && String(props.chat.directBotId) === String(bot.value.id));
});

// The chats you share with the member, newest first: those of yours they're in.
const sharedChats = computed(() => {
  if (isMe.value) return [];
  const has = bot.value
    ? (entry) => (entry.bots || []).some((member) => String(member.botId) === String(bot.value.id))
    : (entry) => (entry.people || []).some((member) => String(member.userId) === String(person.value.id));
  return props.chats
    .filter((entry) => !entry.archivedAt && has(entry))
    .sort((a, b) => String(b.lastActivityAt || "").localeCompare(String(a.lastActivityAt || "")));
});
const allChatsShown = ref(false);
const chatsShown = computed(() => (allChatsShown.value ? sharedChats.value : sharedChats.value.slice(0, 5)));
const nameOfChat = (entry) => chatTitle(entry, props.me);

// Inline editing of a bot's name, for its maker and the home's owners and admins: Enter or leaving the field saves,
// Escape cancels.
const canRename = computed(() => Boolean(bot.value) && Boolean(bot.value.canArchive || props.manages));
const editing = ref(false);
const editValue = ref("");
const editInput = ref(null);

async function startEdit() {
  if (!canRename.value) return;
  editing.value = true;
  editValue.value = bot.value.name;
  await nextTick();
  editInput.value?.focus();
  editInput.value?.select();
}

function commitEdit() {
  if (!editing.value) return;
  editing.value = false;
  const value = editValue.value.trim();
  if (value && value !== bot.value?.name) emit("rename", value);
}

function onEditKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    commitEdit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    editing.value = false;
  }
}

watch(() => `${props.member.kind}:${props.member.bot?.id ?? props.member.person?.id}`, () => {
  editing.value = false;
  allChatsShown.value = false;
});

// Its Library (R11): what it made in the chats the person can open; a page opens in place of the chat (D-74).
const { libraryItems, libraryLoaded, expandedDays, openItem, libraryGroups, sharingItem, pendingDelete, itemMenu, openItemMenu, deletePage } =
  useBotLibrary({
    bot: shown,
    tab,
    activity,
    onFailure: (error) => emit("failure", error),
    onMessages: (changed) => emit("messages", changed)
  });
const madeAt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
// The chat a Library entry was made in: as it names it, else the person's row of it, else the open chat.
const itemChatId = (item) => {
  const id = item.chatId ?? props.chat?.id ?? null;
  return id == null ? null : String(id);
};
// A Library entry names its chat by id (B's botLibrary.js); its name is the person's chat list's.
function itemChatName(item) {
  const known = props.chats.find((entry) => String(entry.id) === String(itemChatId(item))) || (props.chat && !item.chatId ? props.chat : null);
  return known ? nameOfChat(known) : "";
}
const accessOf = (item) => pageAccess(item.path, { chatName: itemChatName(item), homeName: props.homeName });
const sharingOpen = computed({ get: () => Boolean(sharingItem.value), set: (value) => { if (!value) sharingItem.value = null; } });
watch(openItem, (item) => {
  if (item?.kind !== "page") return;
  openItem.value = null;
  emit("open-page", { path: item.path, botId: String(bot.value.id), chatId: itemChatId(item) });
});

// Its Files: this chat's folder when the card is opened from one, then its own and the home's.
const fileSections = computed(() => [
  ...(props.chat ? [{ key: "chat", label: "This chat", root: "/files/chat" }] : []),
  { key: "bot", label: `${bot.value?.name}'s files`, root: "/files/bot" },
  { key: "shared", label: props.homeName || "Whole home", root: "/files/shared" }
]);

// Its routines: in this chat, or, beside another chat, in every chat the person can open, each naming its chat.
const { routines, routinesLoaded, toggleRoutine, highlightedRoutineId, routineMenu, pendingRoutineDelete, openRoutineMenu, deleteRoutine } =
  useBotRoutines({
    bot: shown,
    chat: () => props.chat,
    tab,
    onEdit: (routine) => emit("edit-routine", routine),
    onFailure: (error) => emit("failure", error)
  });
const routineLine = (routine) => {
  const when = routine.enabled ? routine.schedule : "Paused";
  return props.chat || !routine.chatTitle ? when : `${when} · ${routine.chatTitle}`;
};

// Its Instructions (D-98): the template it points at, read-only, and its own additions, which its maker and the home's
// owners and admins edit here; they also change its template.
const {
  instructions, loadInstructions, editingAdditions, additionsDraft, savingAdditions, additionsProblem, additionsBox, additionsChanged,
  editAdditions, cancelAdditions, saveAdditions
} = useBotInstructions({
  bot: shown,
  tab,
  activity,
  onSaved: (changed) => {
    emit("changed", changed);
    emit("notify", "Additions saved");
  },
  onFailure: (error) => emit("failure", error)
});
const template = computed(() => instructions.value?.template || null);
const article = computed(() => (/^[aeiou]/u.test(bot.value?.template?.tag || "") ? "an" : "a"));
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
  instructions.value && !instructions.value.canChange ? `The person who made ${bot.value?.name} and the home's owners and admins change these.` : "");
const changeOpen = ref(false);
function templateChanged(changed) {
  emit("changed", changed);
  emit("notify", `${changed.name} is now ${/^[aeiou]/u.test(changed.template?.tag || "") ? "an" : "a"} ${changed.template?.tag || ""} bot`);
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
  <section class="mb-card" :aria-label="`${name}'s card`">
    <!-- What a copy built on Mercbot adds for a bot (extensions.js). -->
    <div v-if="bot && extensions.botActions.length" class="mb-card__top">
      <component :is="action.component" v-for="(action, at) in extensions.botActions" :key="at" :bot="bot" />
    </div>

    <div class="mb-card__head">
      <div class="mb-card__face">
        <MercbotAvatar v-if="bot" :bot="bot" :size="58" :state="mood" />
        <span v-else class="mb-card__initials" aria-hidden="true">{{ initialsOf(person.name) }}</span>
      </div>
      <input
        v-if="editing"
        ref="editInput"
        v-model="editValue"
        class="mb-card__field"
        aria-label="Bot name"
        maxlength="80"
        @keydown="onEditKeydown"
        @blur="commitEdit"
      >
      <button v-else-if="canRename" type="button" class="mb-card__name mb-card__name--edit" :aria-label="`Rename ${bot.name}`" @click="startEdit">
        {{ bot.name }}
      </button>
      <h2 v-else class="mb-card__name">{{ name }}<span v-if="isMe" class="mb-card__you"> (you)</span></h2>
      <MercbotTemplateTag v-if="bot" :bot="bot" size="medium" action class="mb-card__tag" @open="openInstructions" />
      <p class="mb-card__line">{{ line }}</p>
      <button
        v-if="canMessage"
        type="button"
        class="mb-set-pill mb-set-pill--dark mb-card__message"
        :aria-label="`Message ${name}`"
        @click="emit('message', bot ? { kind: 'bot', bot } : { kind: 'person', person })"
      >
        <v-icon icon="$sms" size="16" /> Message
      </button>
    </div>

    <section v-if="!isMe" class="mb-card__shared" aria-labelledby="mb-card-shared-title">
      <p id="mb-card-shared-title" class="mb-card__section">Chats you share</p>
      <p v-if="!sharedChats.length" class="mb-card__quiet">No chats with {{ name }} yet.</p>
      <ul v-else class="mb-card__chats">
        <li v-for="entry in chatsShown" :key="entry.id">
          <button type="button" class="mb-card__chat" :aria-label="`${nameOfChat(entry)}, ${kindLabel(entry)}`" @click="emit('open-chat', entry.id)">
            <v-icon :icon="kindIcon(entry)" size="16" />
            <span class="mb-card__chat-name">{{ nameOfChat(entry) }}</span>
            <span v-if="chat && String(entry.id) === String(chat.id)" class="mb-card__quiet">This chat</span>
          </button>
        </li>
      </ul>
      <button v-if="sharedChats.length > 5" type="button" class="mb-card__more" @click="allChatsShown = !allChatsShown">
        {{ allChatsShown ? "Show fewer" : `Show all ${sharedChats.length}` }}
      </button>
    </section>

    <template v-if="bot">
      <div class="mb-card__tabs" role="tablist" :aria-label="`${bot.name}'s sections`">
        <button
          v-for="entry in TABS"
          :key="entry.value"
          type="button"
          role="tab"
          class="mb-card__tab"
          :class="{ 'mb-card__tab--selected': tab === entry.value }"
          :aria-selected="tab === entry.value"
          @click="shellPreferences.detailsTab = entry.value"
        >
          {{ entry.title }}
        </button>
      </div>

      <div class="mb-card__content" role="tabpanel">
        <template v-if="tab === 'details'">
          <!-- Its Instructions (D-98): one sentence, its template read-only, its own additions. First, as what it is. -->
          <section
            v-if="instructions"
            ref="instructionsSection"
            class="mb-instructions-section"
            tabindex="-1"
            aria-labelledby="mb-instructions-title"
          >
            <p id="mb-instructions-title" class="mb-card__section mb-instructions__label">Instructions</p>
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
              class="mb-card__box mb-instructions__shown"
              :aria-label="instructions.canChange ? 'Edit additions' : 'Additions'"
              :disabled="!instructions.canChange"
              @click="editAdditions"
            >
              <span v-if="instructions.additions" class="mb-instructions__text mb-instructions__text--clamped">{{ instructions.additions }}</span>
              <span v-else class="mb-card__description">Nothing added. Tweaks here apply only to this bot.</span>
            </button>
            <p v-if="additionsNote && !editingAdditions" class="mb-card__note">{{ additionsNote }}</p>
          </section>
          <MercbotChangeTemplateDialog
            v-model="changeOpen"
            :bot="bot"
            :additions="instructions?.additions || ''"
            @changed="templateChanged"
          />
          <!-- What it knows (D-107), next to what it's told: text and files, always in mind or searched first. -->
          <MercbotKnowledgeSection :bot="bot" :tab="tab" @failure="emit('failure', $event)" />
          <!-- What it remembers of the home's public chats, and the home's notes, which every bot reads (D-113). -->
          <MercbotMemorySection :bot="bot" :tab="tab" @failure="emit('failure', $event)" />
          <MercbotAppsSection :bot="bot" />

          <template v-if="routinesLoaded && routines.length">
            <p class="mb-card__section">Routines</p>
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
                  <span class="mb-routine__schedule">{{ routineLine(routine) }}</span>
                </span>
                <button
                  type="button"
                  role="switch"
                  class="mb-switch"
                  :class="{ 'mb-switch--on': routine.enabled }"
                  :aria-checked="routine.enabled"
                  :aria-label="`${routine.name} on or off`"
                  :disabled="!canSwitchRoutine(routine)"
                  :title="canSwitchRoutine(routine) ? undefined : 'Only the person who set it up can resume it.'"
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
          <div v-else-if="!routinesLoaded" class="mb-card__skeleton" aria-hidden="true" />
          <p v-else class="mb-card__empty">
            Routines are jobs {{ bot.name }} repeats on a schedule. {{ chat ? "Ask in this chat" : "Ask it in a chat" }} to set one up, for example a
            weekly summary.
          </p>
          <!-- The home's main bot, and making this one it. -->
          <MercbotBotMain :bot="bot" :manages="manages" @make-main="emit('make-main', bot)" />
          <!-- Leaving the home, and coming back (D-108). -->
          <MercbotBotArchive :bot="bot" @archive="emit('archive-bot', bot)" @unarchive="emit('unarchive-bot', bot)" />
        </template>

        <!-- Its files (R6): this chat's, when opened from one, then its own folder and the home's. -->
        <FileBrowser
          v-else-if="tab === 'files'"
          :key="`${bot.id}:${chat?.id || ''}`"
          :bot-id="String(bot.id)"
          :chat="chat ? String(chat.id) : null"
          :refresh-key="chat?.lastActivityAt || 0"
          :sections="fileSections"
        />

        <template v-else-if="tab === 'library'">
          <div v-if="libraryItems.length" class="mb-library">
            <section v-for="group in libraryGroups" :key="group.label" class="mb-library__group">
              <p class="mb-library__day">{{ group.label }}</p>
              <!-- Hovering a row shows its card above it. -->
              <v-tooltip v-for="item in group.shown" :key="item.path" location="top start" :offset="2" :open-delay="450" content-class="mb-hover-card">
                <template #activator="{ props: cardProps }">
                  <div v-bind="cardProps" class="mb-library__row" @contextmenu.prevent="openItemMenu($event, item)">
                    <button type="button" class="mb-library__open" :aria-label="`Open ${item.name}`" @click="openItem = item">
                      <img
                        v-if="item.kind === 'picture'"
                        class="mb-library__icon mb-library__thumb"
                        :src="fileUrl(String(bot.id), item.path, { download: false, chat: itemChatId(item) })"
                        alt=""
                      >
                      <span v-else class="mb-library__icon"><v-icon :icon="itemIcon(item)" size="18" /></span>
                      <span class="mb-library__text">
                        <span class="mb-library__name">{{ item.name }}</span>
                        <span class="mb-library__meta">{{ itemMeta(item) }}</span>
                      </span>
                      <v-icon v-if="item.pinned" icon="$keepFilled" size="14" class="mb-library__pin" />
                      <span class="mb-library__age">{{ itemAge(item.createdAt) }}</span>
                    </button>
                    <button
                      type="button"
                      class="mb-library__more"
                      :aria-label="`More for ${item.name}`"
                      aria-haspopup="menu"
                      :aria-expanded="itemMenu.open && itemMenu.path === item.path"
                      @click="openItemMenu($event, item)"
                    >
                      <v-icon icon="$moreHoriz" size="16" />
                    </button>
                  </div>
                </template>
                <span class="mb-hover-card__type">{{ itemType(item) }}</span>
                <span class="mb-hover-card__title">{{ item.name }}</span>
                <span class="mb-hover-card__line"><MercbotAvatar :bot="bot" :size="16" still />{{ bot.name }}</span>
                <span class="mb-hover-card__line">{{ madeAt.format(new Date(item.createdAt)) }}</span>
                <span v-if="item.kind === 'page'" class="mb-hover-card__line"><v-icon :icon="accessOf(item).icon" size="14" />{{ accessOf(item).title }}</span>
              </v-tooltip>
              <button v-if="group.more" type="button" class="mb-library__show-more" @click="expandedDays = new Set([...expandedDays, group.label])">Show more</button>
            </section>
          </div>
          <div v-else-if="!libraryLoaded" class="mb-card__skeleton" aria-hidden="true" />
          <p v-else class="mb-card__empty">
            Anything {{ bot.name }} makes in the chats you can open, like pages, files and apps, will be kept here.
          </p>
          <MercbotContextMenu v-model="itemMenu.open" :target="itemMenu.target" :items="itemMenu.items" />
          <MercbotPageShare
            v-if="sharingItem"
            v-model="sharingOpen"
            :bot-id="String(bot.id)"
            :path="sharingItem.path"
            :title="sharingItem.name"
            :chat-id="itemChatId(sharingItem)"
            :home-name="homeName"
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
          <MercbotFileViewer
            v-else-if="openItem"
            :bot-id="String(bot.id)"
            :chat-id="itemChatId(openItem)"
            :file="{ path: openItem.path, name: ['chart', 'picture'].includes(openItem.kind) ? `${openItem.name}.png` : openItem.name }"
            @close="openItem = null"
          />
        </template>

        <!-- Its computer in this chat (D14, D16): MercbotChatComputers shows it, labelled, with what's signed in. -->
        <MercbotChatComputers
          v-else-if="chat"
          :chat="chat"
          :me="me"
          :home-name="homeName"
          :manages="manages"
          :only-bot-id="String(bot.id)"
          :computer-news="computerNews"
          @open-live="emit('open-computer', $event)"
          @failure="emit('failure', $event)"
        />
        <section v-else class="mb-card__computers" aria-label="Computer">
          <p class="mb-card__plain">{{ bot.name }} has its own computer in each chat it's in. Open one from that chat's details.</p>
          <p class="mb-card__section">Chats you share</p>
          <p v-if="!sharedChats.length" class="mb-card__quiet">No chats with {{ bot.name }} yet.</p>
          <ul v-else class="mb-card__chats">
            <li v-for="entry in sharedChats" :key="entry.id" class="mb-card__chat mb-card__chat--row">
              <v-icon :icon="kindIcon(entry)" size="16" />
              <span class="mb-card__chat-name">{{ nameOfChat(entry) }}<span class="mb-card__kind"> · {{ kindLabel(entry) }}</span></span>
              <button type="button" class="mb-set-pill" :aria-label="`Open ${nameOfChat(entry)}`" @click="emit('open-chat', entry.id)">Open</button>
            </li>
          </ul>
        </section>
      </div>
    </template>
  </section>
</template>

<style scoped src="./MercbotMemberCard.css"></style>
<style scoped src="./MercbotDetailsInstructions.css"></style>
