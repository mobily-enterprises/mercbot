<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotChatAvatar from "./MercbotChatAvatar.vue";
import MercbotNewChat from "./MercbotNewChat.vue";
import MercbotCallBar from "./MercbotCallBar.vue";
import MercbotContextMenu from "./MercbotContextMenu.vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotTooltip from "./MercbotTooltip.vue";
import { mentionBotsOf, mentionPeopleOf, soleBotOf, useComposerTokens } from "./useComposerTokens.js";
import { hasSeveral, initialsOf } from "./messageAuthors.js";
import { chatSubtitle, chatTitle, directBotOf, isDirect, kindIcon, kindLabel, kindMeaning, publicNotice } from "./chatView.js";
import { addPersonQuestion, chatRights } from "./chatMenus.js";
import { useDictation } from "./useDictation.js";
import { useFindInChat } from "./useFindInChat.js";
import { formatSize } from "./filesApi.js";
import { useComposerFiles } from "./useComposerFiles.js";
import { useChatScroll } from "./useChatScroll.js";
import { useComposerKeys } from "./useComposerKeys.js";
import { useComposerLines } from "./useComposerLines.js";
import { useSelectionPill } from "./useSelectionPill.js";
import { shellPreferences } from "./shellPreferences.js";
import MercbotIconButton from "./MercbotIconButton.vue";
import MercbotTimeline from "./MercbotTimeline.vue";
import MercbotArchivedBotBanner from "./MercbotArchivedBotBanner.vue";
import MercbotPageView from "./MercbotPageView.vue";

// Chat panel (D-112, plan 4.4, 4.6): the open chat's header (who's in it and whether it's Public or Private), timeline
// and composer, whose line says who can read what's written; New chat in its place while it's open; and with no chat
// open, where to start (D4). Also find in chat, add selection and mic errors.
const props = defineProps({
  // The open chat's row, or null.
  chat: { type: Object, default: null },
  messages: { type: Array, required: true },
  // The home's people and bots (useTeam), null while they load: New chat's choices, the Add menu, and authors.
  people: { type: Array, default: null },
  teamBots: { type: Array, default: () => [] },
  homeName: { type: String, default: "this home" },
  manages: { type: Boolean, default: false },
  phone: { type: Boolean, default: false },
  // On a phone, whether another chat has news (the drawer button's dot).
  otherNews: { type: Boolean, default: false },
  status: { type: String, default: "" },
  statusMood: { type: String, default: "working" },
  placeholder: { type: String, default: "" },
  draft: { type: String, default: "" },
  columnWidth: { type: Number, required: true },
  findOpen: { type: Boolean, default: false },
  // New chat's choices while it's open ({ kind, people, bots, title }), otherwise null.
  newChat: { type: Object, default: null },
  starting: { type: Boolean, default: false },
  statusBots: { type: Array, default: () => [] },
  unreadAfter: { type: String, default: null },
  // The signed-in person: their own messages are on the right.
  me: { type: String, default: "" },
  // The chat has messages older than these; loadOlder reads the page before them (and reports its own failure).
  hasOlder: { type: Boolean, default: false },
  loadOlder: { type: Function, required: true },
  // Find in chat: the matches in the pages not loaded yet ({ count, newest, oldest }, from the server), and
  // bringing the pages down to a message when the person goes to a match in them.
  findOlder: { type: Function, required: true },
  loadThrough: { type: Function, required: true },
  // A page open in place of the chat (D-74): { botId, chatId, path, title, stamp, botName }, or null.
  page: { type: Object, default: null }
});
const emit = defineEmits([
  "open-details", "close-find", "voice-ended", "send", "choose", "connect",
  "react", "copy", "copy-image", "retry", "teach", "update:draft", "answer",
  "take-over", "use-computer", "secure-form", "settle-draft", "manage-rules", "settle-handover", "open-skill", "cancel-request",
  "failure", "open-page", "close-page", "open-direct",
  "new-chat-change", "new-chat-close", "new-chat-start", "new-chat-join", "new-chat", "new-bot", "team", "menu",
  "unarchive-bot", "unarchive-chat", "join", "add-member", "continue-with-others"
]);

const chatId = computed(() => props.chat?.id || "");
const title = computed(() => (props.chat ? chatTitle(props.chat, props.me) : ""));
const writing = computed(() => Boolean(props.newChat) || Boolean(props.chat));
// A chat's one bot: its colour, its "/" skills, teaching it a task.
const soleBot = computed(() => (props.newChat ? null : soleBotOf(props.chat)));
const directBot = computed(() => (props.newChat ? null : directBotOf(props.chat)));
// A direct chat with a bot that's archived (D-108) is read-only until it's back.
const archivedBot = computed(() => {
  if (!isDirect(props.chat) || props.newChat) return null;
  return props.teamBots.find((bot) => String(bot.id) === String(props.chat.directBotId) && bot.archivedAt) || null;
});
const may = computed(() => (props.chat ? chatRights(props.chat, { me: props.me, manages: props.manages }) : {}));

// Where the composer stands: a banner in its place for a chat that can't be written in now.
const blocked = computed(() => {
  if (props.newChat || !props.chat) return "";
  if (props.chat.archivedAt) return "archived";
  if (archivedBot.value) return "bot-archived";
  if (props.chat.visiting) return "visiting";
  return "";
});

// The first-time notice above a public chat's composer (plan 8): once per device, until dismissed.
const notice = computed(() => (
  props.chat && !props.newChat && !blocked.value && props.chat.kind !== "private" && !shellPreferences.publicNoticeSeen
    ? publicNotice(props.homeName)
    : null
));

// + Add (plan 4.4): the home's people and active bots not in the chat yet. A direct chat takes no one else, the
// everyone chat has everyone already, and only the chat's people add to it.
const canAdd = computed(() => Boolean(props.chat) && !props.newChat && !isDirect(props.chat) && !blocked.value);
// A direct chat goes on with others in a new chat instead (D-114), its person's alone.
const canContinue = computed(() => Boolean(props.chat) && !props.newChat && isDirect(props.chat) && !blocked.value);
const addMenu = ref({ open: false, target: [0, 0] });
const addItems = computed(() => {
  if (!props.chat) return [];
  const peopleIn = new Set(props.chat.people.map((person) => String(person.userId)));
  const botsIn = new Set(props.chat.bots.map((bot) => String(bot.botId)));
  const people = (props.people || []).filter((person) => !peopleIn.has(String(person.id)))
    .map((person) => ({ title: person.name, icon: "$person", run: () => addPerson(person) }));
  const bots = props.teamBots.filter((bot) => !bot.archivedAt && !botsIn.has(String(bot.id)))
    .map((bot) => ({ title: bot.name, icon: "$smartToy", run: () => emit("add-member", { kind: "bot", id: String(bot.id) }) }));
  const items = [...people, ...(people.length && bots.length ? [{ divider: true }] : []), ...bots];
  return items.length ? items : [{ title: "Everyone's in this chat already", disabled: true, run: () => {} }];
});
// A person into a private chat is asked about first (they'll read all of it); into a public one, at once.
const addingPerson = ref(null);
const addQuestion = computed(() => (addingPerson.value && props.chat ? addPersonQuestion(props.chat, title.value, addingPerson.value.name) : null));
function addPerson(person) {
  if (props.chat && addPersonQuestion(props.chat, title.value, person.name)) addingPerson.value = person;
  else emit("add-member", { kind: "person", id: String(person.id) });
}
function confirmAddPerson() {
  emit("add-member", { kind: "person", id: String(addingPerson.value.id) });
  addingPerson.value = null;
}
function openAddMenu(event) {
  const box = event.currentTarget.getBoundingClientRect();
  addMenu.value = { open: true, target: [box.left, box.bottom + 4] };
}

// A short confirmation pill at the bottom right of the chat panel.
const toast = ref("");
let toastTimer = null;
function showToast(text) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 4000);
}

const scroller = ref(null);
const column = ref(null);
const input = ref(null);
const measure = ref(null);
const fileInput = ref(null);
const findInput = ref(null);
const composerFocused = ref(false);

// The draft belongs to the shell so each chat keeps its own unsent text.
const draft = computed({
  get: () => props.draft,
  set: (value) => emit("update:draft", value)
});
const attachments = ref([]);
const quotes = ref([]);
const replyTarget = ref(null);
const lines = ref(1);
const hasContent = computed(() => Boolean(draft.value.trim() || attachments.value.length || quotes.value.length));
const stacked = computed(() => lines.value > 1 || attachments.value.length > 0 || quotes.value.length > 0 || Boolean(replyTarget.value));
const columnStyle = computed(() => ({ width: `${props.columnWidth}px` }));
const dock = ref(null);
const composerPlaceholder = computed(() => {
  if (dictating.value) return "Listening…";
  if (replyTarget.value) return "Write your reply";
  if (attachments.value.length) return "Add a note, or just send";
  if (props.newChat) return "Write the first message";
  return props.placeholder || "Write a message";
});

const { measureLines, inputHeight } =
  useComposerLines({ draft, lines, stacked, measure, input });

const { awayFromBottom, unseen, dockHeight, updateScrollState, scrollToBottom, showMessage } =
  useChatScroll({ scroller, column, dock, messages: () => props.messages, status: () => props.status, me: () => props.me });

// New chat's Start line (its hint and Start) stays above the message box as the box grows, as a long first message
// makes it on a phone: the column leaves room under it for the box (dockHeight), and the line is scrolled into it.
watch(dockHeight, () => {
  if (props.newChat) nextTick(keepStartLineClear);
});
function keepStartLineClear() {
  const start = column.value?.querySelector(".mb-new-chat__start");
  if (!start || !dock.value || !scroller.value) return;
  const covered = start.getBoundingClientRect().bottom - dock.value.getBoundingClientRect().top;
  if (covered > 0) scroller.value.scrollBy({ top: Math.ceil(covered) + 8 });
}

// A chat opens on its newest page: scrolling near the top reads the page before and puts
// it above, and the reader stays on the message they were reading.
const OLDER_WITHIN_PX = 600;
let readingOlder = false;
async function readOlder() {
  const element = scroller.value;
  if (readingOlder || !props.hasOlder || !element || element.scrollTop > OLDER_WITHIN_PX) return;
  readingOlder = true;
  const reading = chatId.value;
  const fromBottom = element.scrollHeight - element.scrollTop;
  try {
    await props.loadOlder();
    await nextTick();
    if (chatId.value === reading) element.scrollTop = element.scrollHeight - fromBottom;
  } finally {
    readingOlder = false;
  }
}
function onScroll() {
  updateScrollState();
  readOlder();
}

watch(chatId, () => {
  attachments.value = [];
  quotes.value = [];
  replyTarget.value = null;
  nextTick(() => {
    scrollToBottom("auto");
    updateScrollState();
    measureLines();
  });
});

// Mentions and skills in the composer are tokens (useComposerTokens): @ in a chat of several, "/" with one bot.
const newChatBots = computed(() => (props.newChat?.bots || [])
  .map((id) => props.teamBots.find((bot) => String(bot.id) === id))
  .filter(Boolean)
  .map((bot) => ({ id: String(bot.id), name: bot.name, color: bot.color, shape: bot.shape, archivedAt: null })));
const several = computed(() => (props.newChat ? props.newChat.people.length + props.newChat.bots.length > 1 : hasSeveral(props.chat)));
const mentionBots = computed(() => (props.newChat ? newChatBots.value : mentionBotsOf(props.chat)));
// The people @ offers (D-114): the chat's others, or New chat's To: line.
const mentionPeople = computed(() => (props.newChat
  ? props.newChat.people.map((id) => (props.people || []).find((person) => String(person.id) === id)).filter(Boolean).map((person) => ({ id: String(person.id), name: person.name }))
  : mentionPeopleOf(props.chat, props.me)));
// In a chat of several, the mic is the round accent button.
const filledMic = computed(() => several.value && !hasContent.value);
const composerTokens = useComposerTokens({ draft, input, several, mentionBots, mentionPeople, chatId: () => chatId.value || null });
const { tokens, mention, slash, skillRows, mentionRows, updateMention, insertSkill, insertMention, snapCaret, mirrorParts, withMarkers } = composerTokens;
const tokenColor = computed(() => soleBot.value?.color || newChatBots.value[0]?.color || undefined);

const mirror = ref(null);
function syncMirror() {
  if (mirror.value && input.value) mirror.value.scrollTop = input.value.scrollTop;
}

function send() {
  // Enter on an empty composer starts New chat empty.
  if (!hasContent.value) {
    if (props.newChat) emit("new-chat-start");
    return;
  }
  // Sending always goes to the bottom, wherever the reader was.
  scrollToBottom();
  emit("send", {
    text: withMarkers(draft.value.trim()),
    quotes: [...quotes.value],
    // New chat's files wait on their `file` until the chat is made (useNewChat).
    attachments: attachments.value.map(({ name, size, type, text, path, file }) => ({ name, size, type, ...(text ? { text } : {}), ...(path ? { path } : file ? { file } : {}) })),
    replyTo: replyTarget.value ? { id: replyTarget.value.id, text: replyTarget.value.text } : null
  });
  draft.value = "";
  tokens.value = [];
  attachments.value = [];
  quotes.value = [];
  replyTarget.value = null;
}

const { onComposerKeydown } = useComposerKeys({ draft, input, quotes, replyTarget, tokens: composerTokens, send });

function focusComposer() {
  input.value?.focus();
}

const { addFiles } = useComposerFiles({
  attachments,
  chat: () => (props.newChat ? null : props.chat),
  focusComposer,
  onFailure: (error) => emit("failure", error)
});

function startReply(message) {
  replyTarget.value = { id: message.id, text: message.body.text || message.body.heading || "" };
  focusComposer();
}

const { findQuery, findTotal, findPosition, stepFind, onFindKeydown } = useFindInChat({
  column,
  scroller,
  findInput,
  open: computed(() => props.findOpen),
  messageCount: () => props.messages.length,
  oldestLoaded: () => props.messages.find((message) => /^\d+$/u.test(String(message.id)))?.id ?? null,
  older: { matches: (text) => props.findOlder(text), bringDown: (messageId) => props.loadThrough(messageId) },
  close: () => emit("close-find")
});
// A voice conversation is with one bot: a direct chat's.
const { micError, dictating, calling, canCall, dictationPress, dictationRelease, toggleDictation, startCall, callFailed, callEnded } = useDictation({
  draft,
  chatId: () => (props.newChat ? null : chatId.value || null),
  botId: () => directBot.value?.id ?? null,
  focusComposer,
  voiceEnded: (call) => emit("voice-ended", call)
});

const { selectionPill, addSelection } = useSelectionPill({ column, scroller, quotes, focusComposer });

onMounted(() => {
  scrollToBottom("auto");
  updateScrollState();
  measureLines();
});

onBeforeUnmount(() => clearTimeout(toastTimer));

defineExpose({ focusComposer, addSelection, startReply, toggleDictation, dictationPress, dictationRelease, showToast, showMessage });
</script>

<template>
  <main class="mb-chat" :aria-label="chat && !newChat ? title : 'Chat'">
    <!-- A phone's chat header (plan 4.6): the drawer, the chat's name and who's in it, and its details. -->
    <header v-if="phone && chat && !newChat && !page" class="mb-chat__phone-head">
      <span class="mb-chat__menu">
        <MercbotIconButton icon="$menu" label="Your chats" tone="surface" @click="emit('menu')" />
        <span v-if="otherNews" class="mb-chat__menu-dot" aria-hidden="true" />
      </span>
      <button type="button" class="mb-chat__phone-title" :aria-label="`${title} details`" @click="emit('open-details')">
        <span class="mb-chat__phone-name">{{ title }}</span>
        <span class="mb-chat__phone-sub">{{ chatSubtitle(chat, me) }}</span>
      </button>
      <MercbotIconButton v-if="canContinue" icon="$forkRight" label="Continue with others…" tone="surface" @click="emit('continue-with-others')" />
      <MercbotIconButton icon="$info" label="Chat details" tone="surface" @click="emit('open-details')" />
    </header>

    <!-- With no chat open: where to start (D4). -->
    <div v-if="!chat && !newChat" class="mb-chat__start" :style="columnStyle">
      <h2 class="mb-chat__start-title">No chats yet</h2>
      <p class="mb-chat__start-text">Start a chat with people and bots in {{ homeName }}, or message someone on your team.</p>
      <div class="mb-chat__start-actions">
        <v-btn color="primary" variant="flat" prepend-icon="$chat" @click="emit('new-chat')">New chat</v-btn>
        <v-btn variant="text" prepend-icon="$group" @click="emit('team')">Team</v-btn>
        <v-btn variant="text" prepend-icon="$smartToy" @click="emit('new-bot')">Add bots</v-btn>
      </div>
    </div>

    <!-- An open page covers the chat, which stays where it was underneath (D-74). -->
    <div
      v-else
      ref="scroller"
      class="mb-chat__scroller"
      :class="{ 'mb-chat__scroller--covered': page, 'mb-chat__scroller--headed': phone && chat && !newChat }"
      @scroll.passive="onScroll"
    >
      <div ref="column" class="mb-chat__column" :style="{ ...columnStyle, paddingBottom: `${dockHeight + 40}px` }">
        <MercbotNewChat
          v-if="newChat"
          :choice="newChat"
          :people="people || []"
          :bots="teamBots.filter((bot) => !bot.archivedAt)"
          :me="me"
          :home-name="homeName"
          :starting="starting"
          @change="emit('new-chat-change', $event)"
          @close="emit('new-chat-close')"
          @start="emit('new-chat-start')"
          @join="emit('new-chat-join', $event)"
        />
        <MercbotTimeline
          v-else
          :chat="chat"
          :home-name="homeName"
          :messages="messages"
          :status="status"
          :status-mood="statusMood"
          :unread-after="unreadAfter"
          :status-bots="statusBots"
          :me="me"
          :people="people"
          :bots="teamBots"
          @choose="emit('choose', $event)"
          @answer="emit('answer', $event)"
          @focus-composer="focusComposer"
          @open-skill="emit('open-skill', $event)"
          @cancel-request="emit('cancel-request', $event)"
          @take-over="emit('take-over', $event)"
          @use-computer="emit('use-computer', $event)"
          @secure-form="emit('secure-form', $event)"
          @settle-draft="emit('settle-draft', $event)"
          @manage-rules="emit('manage-rules')"
          @settle-handover="emit('settle-handover', $event)"
          @connect="emit('connect', $event)"
          @react="emit('react', $event)"
          @reply="startReply"
          @copy="emit('copy', $event)"
          @copy-image="emit('copy-image', $event)"
          @retry="emit('retry', $event)"
          @open-page="emit('open-page', $event)"
          @open-direct="emit('open-direct', $event)"
        />
      </div>
    </div>

    <MercbotPageView
      v-if="page"
      :key="`${page.chatId || ''}:${page.botId}:${page.path}`"
      :bot-id="page.botId"
      :path="page.path"
      :title="page.title"
      :chat-id="page.chatId"
      :home-name="homeName"
      :stamp="page.stamp"
      :bot-name="page.botName"
      :me="me"
      :bottom="dockHeight"
      @close="emit('close-page')"
      @toast="showToast"
      @failure="emit('failure', $event)"
    />

    <div v-if="!page && writing" class="mb-chat__fade" aria-hidden="true" />

    <!-- The chat's header (plan 4.4): who's in it, Public or Private, + Add, and its details. -->
    <div v-if="chat && !newChat && !page && !phone" class="mb-chat__head">
      <button type="button" class="mb-chip" :aria-label="`${title} details`" @click="emit('open-details')">
        <MercbotChatAvatar :chat="chat" :me="me" :size="22" still />
        <span class="mb-chip__text">
          <span class="mb-chip__name">{{ title }}</span>
          <span class="mb-chip__tag">
            <v-icon :icon="kindIcon(chat)" size="11" />
            {{ kindLabel(chat) }}<template v-if="!isDirect(chat)"> · {{ chatSubtitle(chat, me).split(" · ")[0] }}</template>
          </span>
        </span>
        <v-icon icon="$info" size="16" class="mb-chip__info" />
      </button>
      <MercbotIconButton v-if="canAdd" icon="$personAdd" label="Add people or bots" tone="surface" @click="openAddMenu" />
      <MercbotIconButton v-else-if="canContinue" icon="$forkRight" label="Continue with others…" tone="surface" @click="emit('continue-with-others')" />
      <MercbotContextMenu v-model="addMenu.open" :target="addMenu.target" :items="addItems" />
      <MercbotConfirmDialog
        :model-value="Boolean(addQuestion)"
        :title="addQuestion?.title || ''"
        :text="addQuestion?.text || ''"
        :confirm-label="addQuestion?.confirmLabel"
        :danger="false"
        @update:model-value="!$event && (addingPerson = null)"
        @confirm="confirmAddPerson"
      />
    </div>

    <MercbotCallBar
      v-if="calling && directBot"
      :bot="directBot"
      :messages="messages"
      @say="emit('send', { text: $event, quotes: [], attachments: [], replyTo: null })"
      @failed="callFailed"
      @ended="callEnded"
    />

    <div v-if="micError" class="mb-mic-error" role="alert">
      <v-icon icon="$errorFilled" size="22" class="mb-mic-error__icon" />
      <div class="mb-mic-error__text">
        <p class="mb-mic-error__title">Mercbot can't hear you: {{ micError }}</p>
        <p class="mb-mic-error__hint">Make sure a mic is plugged in and that this site is allowed to use it.</p>
        <button type="button" class="mb-mic-error__dismiss" @click="micError = null">Dismiss</button>
      </div>
    </div>

    <div
      v-if="selectionPill"
      class="mb-selection-pill"
      :style="{ top: `${selectionPill.top}px`, left: `${selectionPill.left}px` }"
    >
      <button type="button" @mousedown.prevent @click="addSelection">
        Add to chat <kbd>Ctrl L</kbd>
      </button>
    </div>

    <div v-if="findOpen" class="mb-find" role="search">
      <v-icon icon="$search" size="16" class="mb-find__icon" />
      <input
        ref="findInput"
        v-model="findQuery"
        class="mb-find__input"
        type="search"
        aria-label="Find in chat"
        placeholder="Find in chat"
        @keydown="onFindKeydown"
      >
      <span class="mb-find__count" aria-live="polite">
        {{ findTotal ? `${findPosition + 1}/${findTotal}` : findQuery ? "0/0" : "" }}
      </span>
      <span class="mb-find__divider" />
      <v-btn icon="$collapse" size="24" variant="text" density="comfortable" aria-label="Previous match" :disabled="!findTotal" @click="stepFind(-1)" />
      <v-btn icon="$expand" size="24" variant="text" density="comfortable" aria-label="Next match" :disabled="!findTotal" @click="stepFind(1)" />
      <v-btn icon="$close" size="24" variant="text" density="comfortable" aria-label="Close find" @click="emit('close-find')" />
    </div>

    <Transition name="mb-toast">
      <div v-if="toast" class="mb-toast" role="status">
        <v-icon icon="$checkCircleFilled" size="16" class="mb-toast__icon" />
        <span class="mb-toast__text">{{ toast }}</span>
        <button type="button" class="mb-toast__close" aria-label="Dismiss" @click="toast = ''">
          <v-icon icon="$close" size="14" />
        </button>
      </div>
    </Transition>

    <div ref="dock" class="mb-chat__dock" :style="columnStyle">
      <!-- Scrolled up, a reply that arrives leaves the view where it is and shows in a pill instead. New chat has no
           latest message to go to, so neither shows over it. -->
      <div v-if="awayFromBottom && unseen && !page && !newChat" class="mb-chat__to-bottom mb-new-pill" role="status">
        <button type="button" class="mb-new-pill__jump" @click="scrollToBottom('auto')">
          <v-icon icon="$arrowdown" size="16" />
          {{ unseen === 1 ? "1 new message" : `${unseen} new messages` }}
        </button>
        <button type="button" class="mb-new-pill__close" aria-label="Dismiss new messages" @click="unseen = 0">
          <v-icon icon="$close" size="14" />
        </button>
      </div>
      <div v-else-if="awayFromBottom && !page && !newChat" class="mb-chat__to-bottom">
        <MercbotIconButton
          icon="$arrowdown"
          label="Scroll to the latest message"
          size="small"
          tone="surface"
          class="mb-chat__to-bottom-button"
          @click="scrollToBottom()"
        />
      </div>

      <slot name="notice" />
      <!-- What public means, the first time (plan 8). -->
      <div v-if="notice" class="mb-public-notice" role="note">
        <v-icon icon="$language" size="18" class="mb-public-notice__icon" />
        <p class="mb-public-notice__text"><strong>{{ notice.title }}.</strong> {{ notice.text }}</p>
        <button type="button" class="mb-public-notice__dismiss" @click="shellPreferences.publicNoticeSeen = true">Got it</button>
      </div>
      <!-- A chat that can't be written in now says why where the composer was. -->
      <div v-if="blocked === 'archived'" class="mb-chat-banner" role="status">
        <v-icon icon="$archive" size="18" />
        <span class="mb-chat-banner__text">This chat is archived, so it's read-only.</span>
        <button v-if="may.archive" type="button" class="mb-chat-banner__action" @click="emit('unarchive-chat')">Unarchive</button>
      </div>
      <!-- A direct chat with an archived bot is read-only until it's back (D-108). -->
      <MercbotArchivedBotBanner
        v-else-if="blocked === 'bot-archived'"
        :bot="archivedBot"
        :home-name="homeName"
        @unarchive="emit('unarchive-bot', archivedBot.id)"
      />
      <div v-else-if="blocked === 'visiting'" class="mb-chat-banner" role="status">
        <v-icon icon="$language" size="18" />
        <span class="mb-chat-banner__text">You're reading a public chat you're not in. Join it to write here.</span>
        <button type="button" class="mb-chat-banner__action" @click="emit('join')">Join</button>
      </div>
      <div v-else-if="writing" class="mb-composer" :class="{ 'mb-composer--focused': composerFocused, 'mb-composer--stacked': stacked }">
        <div v-if="replyTarget" class="mb-composer__reply">
          <span class="mb-composer__reply-text">{{ replyTarget.text }}</span>
          <button type="button" class="mb-composer__remove" aria-label="Stop replying" @click="replyTarget = null">
            <v-icon icon="$close" size="14" />
          </button>
        </div>
        <div v-if="attachments.length" class="mb-composer__files">
          <div v-for="file in attachments" :key="file.id" class="mb-file-card">
            <span class="mb-file-card__icon"><v-icon icon="$description" size="18" /></span>
            <span class="mb-file-card__text">
              <span class="mb-file-card__name">{{ file.name }}</span>
              <span class="mb-file-card__size">{{ formatSize(file.size) }}</span>
            </span>
            <button
              type="button"
              class="mb-file-card__remove"
              :aria-label="`Remove ${file.name}`"
              @click="attachments = attachments.filter((entry) => entry.id !== file.id)"
            >
              <v-icon icon="$close" size="14" />
            </button>
          </div>
        </div>
        <div v-if="quotes.length" class="mb-composer__quotes">
          <span v-for="(quote, index) in quotes" :key="index" class="mb-quote-token">
            <v-icon icon="$formatQuote" size="14" />
            <span class="mb-quote-token__text">“{{ quote }}”</span>
            <button type="button" class="mb-composer__remove" aria-label="Remove quote" @click="quotes = quotes.filter((_, at) => at !== index)">
              <v-icon icon="$close" size="12" />
            </button>
          </span>
        </div>

        <div class="mb-composer__main">
          <v-menu location="top start" :offset="8" content-class="mb-popover">
            <template #activator="{ props: plusProps }">
              <MercbotIconButton
                v-bind="plusProps"
                icon="$add"
                label="Add files and more"
                tone="secondary"
                size="small"
                tooltip-location="top"
                class="mb-composer__plus"
              />
            </template>
            <v-list density="compact" class="py-1" width="200">
              <v-list-item min-height="32" class="px-3" @click="fileInput.click()">
                <template #prepend><v-icon icon="$attachFile" size="14" /></template>
                <span class="mb-composer__menu-text">Attach files</span>
              </v-list-item>
              <!-- Teaching is for one bot: a chat with one. -->
              <v-list-item v-if="soleBot" min-height="32" class="px-3" @click="emit('teach', { botId: String(soleBot.botId) })">
                <template #prepend><v-icon icon="$radioOn" size="14" color="error" /></template>
                <span class="mb-composer__menu-text">Teach {{ soleBot.name }} a task</span>
              </v-list-item>
            </v-list>
          </v-menu>
          <input ref="fileInput" type="file" multiple hidden @change="addFiles">
          <div class="mb-composer__field">
            <div v-if="tokens.length" ref="mirror" class="mb-composer__mirror" :style="{ height: inputHeight }" aria-hidden="true">
              <template v-for="(part, index) in mirrorParts" :key="index">
                <span v-if="part.token?.kind === 'skill'" class="mb-mention mb-skill-token" :style="{ color: tokenColor, '--mb-token-tint': tokenColor }">/{{ part.token.label }}</span>
                <span v-else-if="part.token" class="mb-mention" :style="{ color: part.token.bot ? part.token.bot.color : undefined }">
                  <span class="mb-mention__at">@<span class="mb-mention__avatar">
                    <MercbotAvatar v-if="part.token.bot" :bot="part.token.bot" :size="14" still />
                    <v-icon v-else :icon="part.token.kind === 'everyone' ? '$groupFilled' : part.token.kind === 'person' ? '$person' : '$alternateEmail'" size="12" />
                  </span></span>{{ part.token.label }}
                </span>
                <template v-else>{{ part.text }}</template>
              </template>
            </div>
            <textarea
              ref="input"
              v-model="draft"
              class="mb-composer__input"
              :class="{ 'mb-composer__input--masked': tokens.length }"
              :style="{ height: inputHeight }"
              rows="1"
              :spellcheck="shellPreferences.spellcheck"
              :aria-label="newChat ? 'First message' : `Message ${title}`"
              :placeholder="composerPlaceholder"
              @keydown="onComposerKeydown"
              @input="updateMention"
              @click="snapCaret(); updateMention()"
              @keyup="snapCaret()"
              @scroll="syncMirror"
              @focus="composerFocused = true"
              @blur="composerFocused = false; mention = null; slash = null"
            />
            <ul v-if="slash && skillRows.length" class="mb-mention-menu" role="listbox" aria-label="Skills">
              <li
                v-for="(row, index) in skillRows"
                :key="row.id"
                class="mb-mention-menu__row"
                :class="{ 'mb-mention-menu__row--active': index === slash.active }"
                role="option"
                :aria-selected="index === slash.active"
                @mouseenter="slash = { ...slash, active: index }"
                @mousedown.prevent="insertSkill(row)"
              >
                <span class="mb-mention-menu__glyph"><v-icon icon="$menuBook" size="12" /></span>
                <span class="mb-mention-menu__name mb-skill-menu__name">{{ row.name }}</span>
                <span class="mb-skill-menu__description">{{ row.description }}</span>
              </li>
            </ul>
            <ul v-if="mention && mentionRows.length" class="mb-mention-menu" role="listbox" aria-label="Mention">
              <li
                v-for="(row, index) in mentionRows"
                :key="row.key"
                class="mb-mention-menu__row"
                :class="{ 'mb-mention-menu__row--active': index === mention.active }"
                role="option"
                :aria-selected="index === mention.active"
                @mouseenter="mention = { ...mention, active: index }"
                @mousedown.prevent="insertMention(row)"
              >
                <MercbotAvatar v-if="row.bot" :bot="row.bot" :size="18" still />
                <span v-else-if="row.kind === 'person'" class="mb-mention-menu__glyph mb-mention-menu__initials">{{ initialsOf(row.label) }}</span>
                <span v-else class="mb-mention-menu__glyph"><v-icon :icon="row.kind === 'everyone' ? '$groupFilled' : row.kind === 'skill' ? '$menuBook' : '$extension'" size="12" /></span>
                <span class="mb-mention-menu__name">{{ row.label }}</span>
                <span v-if="row.status" class="mb-mention-menu__status">{{ row.status }}</span>
                <span class="mb-mention-menu__type">{{ row.type === "everyone" ? "bot" : row.type }}</span>
              </li>
            </ul>
          </div>
          <textarea ref="measure" class="mb-composer__measure" rows="1" tabindex="-1" aria-hidden="true" />
          <span class="mb-composer__spacer" />
          <!-- The globe or the lock (plan 8): what this chat's kind means, on hover or focus. -->
          <MercbotTooltip v-if="chat && !newChat" :text="kindMeaning(chat, homeName)" location="top">
            <template #default="{ props: tooltipProps }">
              <span v-bind="tooltipProps" class="mb-composer__kind" tabindex="0" :aria-label="`${kindLabel(chat)}: ${kindMeaning(chat, homeName)}`">
                <v-icon :icon="kindIcon(chat)" size="16" />
              </span>
            </template>
          </MercbotTooltip>
          <MercbotIconButton
            :icon="dictating ? '$mic' : '$mic'"
            :label="dictating ? 'Stop dictating' : 'Dictate'"
            tooltip="Click to dictate, or hold to talk"
            :tooltip-keys="['Ctrl', 'D']"
            :tone="filledMic ? 'primary' : 'secondary'"
            size="small"
            tooltip-location="top"
            :aria-pressed="dictating"
            class="mb-composer__mic"
            :class="{ 'mb-composer__mic--listening': dictating }"
            @pointerdown="dictationPress"
            @pointerup="dictationRelease"
            @keydown.enter.prevent="toggleDictation"
            @keydown.space.prevent="toggleDictation"
          />
          <MercbotIconButton
            v-if="hasContent"
            icon="$arrowup"
            label="Send message"
            tone="primary"
            size="small"
            tooltip-location="top"
            @click="send"
          />
          <MercbotIconButton
            v-else-if="canCall"
            icon="$graphicEq"
            label="Start a voice conversation"
            tooltip="Start a voice conversation"
            tone="primary"
            size="small"
            tooltip-location="top"
            @click="startCall"
          />
        </div>
      </div>
    </div>
  </main>
</template>

<style scoped src="./MercbotChatPanel.css"></style>
