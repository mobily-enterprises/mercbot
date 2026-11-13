<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotConvoAvatar from "./MercbotConvoAvatar.vue";
import MercbotGroupPicker from "./MercbotGroupPicker.vue";
import MercbotCallBar from "./MercbotCallBar.vue";
import { useComposerTokens } from "./useComposerTokens.js";
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
import MercbotRoomTabs from "./MercbotRoomTabs.vue";
import MercbotPageView from "./MercbotPageView.vue";

// Chat panel: timeline, composer, find in chat, add selection, mic errors.
const props = defineProps({
  bot: { type: Object, required: true },
  messages: { type: Array, required: true },
  status: { type: String, default: "" },
  statusMood: { type: String, default: "working" },
  placeholder: { type: String, default: "" },
  draft: { type: String, default: "" },
  columnWidth: { type: Number, required: true },
  findOpen: { type: Boolean, default: false },
  // Starting a group chat: { chosen, candidates } while picking, otherwise null.
  picker: { type: Object, default: null },
  statusBots: { type: Array, default: () => [] },
  unreadAfter: { type: String, default: null },
  // The signed-in person, so a shared bot's room can label everyone else's messages (D-36).
  me: { type: String, default: "" },
  // The chat has messages older than these; loadOlder reads the page before them (and
  // reports its own failure).
  hasOlder: { type: Boolean, default: false },
  loadOlder: { type: Function, required: true },
  // Find in chat: the matches in the pages not loaded yet ({ count, newest, oldest }, from the server), and
  // bringing the pages down to a message when the person goes to a match in them.
  findOlder: { type: Function, required: true },
  loadThrough: { type: Function, required: true },
  // A page open in place of the chat (D-74): { botId, path, title, group, stamp }, or null.
  page: { type: Object, default: null }
});
const emit = defineEmits([
  "open-details", "close-find", "voice-ended", "send", "choose", "connect",
  "react", "copy", "copy-image", "retry", "teach", "update:draft", "answer",
  "take-over", "use-computer", "secure-form", "settle-draft", "manage-rules", "settle-handover", "open-skill", "open-bot", "cancel-request", "picker-change", "picker-close", "picker-new-bot", "picker-start",
  "failure", "room-select", "room-create", "room-rename", "undo-note", "open-page", "close-page"
]);

// A shared bot's open tab, and the one it continues from (D-36).
const room = computed(() => props.bot.rooms?.find((entry) => entry.id === props.bot.roomId) || null);
const parentRoom = computed(() => props.bot.rooms?.find((entry) => entry.id === room.value?.parentId) || null);

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

// The draft belongs to the shell so each bot keeps its own unsent text.
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
  // With several people in a group, bots only answer when named (D-46).
  if (props.bot.kind === "group" && props.bot.people?.length > 1) return "Message everyone, or @mention a bot to ask it";
  return props.placeholder || `Message ${props.bot.name}`;
});

const { measureLines, inputHeight } =
  useComposerLines({ draft, lines, stacked, measure, input, columnWidth: () => props.columnWidth });

const { awayFromBottom, unseen, dockHeight, updateScrollState, scrollToBottom, showMessage } =
  useChatScroll({ scroller, column, dock, messages: () => props.messages, status: () => props.status, me: () => props.me });

// A chat opens on its newest page: scrolling near the top reads the page before and puts
// it above, and the reader stays on the message they were reading.
const OLDER_WITHIN_PX = 600;
let readingOlder = false;
async function readOlder() {
  const element = scroller.value;
  if (readingOlder || !props.hasOlder || !element || element.scrollTop > OLDER_WITHIN_PX) return;
  readingOlder = true;
  const botId = props.bot.id;
  const fromBottom = element.scrollHeight - element.scrollTop;
  try {
    await props.loadOlder();
    await nextTick();
    if (props.bot.id === botId) element.scrollTop = element.scrollHeight - fromBottom;
  } finally {
    readingOlder = false;
  }
}
function onScroll() {
  updateScrollState();
  readOlder();
}

watch(() => props.bot.id, () => {
  attachments.value = [];
  quotes.value = [];
  replyTarget.value = null;
  nextTick(() => {
    scrollToBottom("auto");
    updateScrollState();
    measureLines();
  });
});

// Mentions and skills in the composer are tokens (useComposerTokens).
const group = computed(() => props.bot.kind === "group" || Boolean(props.picker));
// In a group, and while picking with bots chosen, the mic is the round accent button.
const filledMic = computed(() => (props.picker ? props.picker.chosen.length > 0 : props.bot.kind === "group") && !hasContent.value);
const groupBots = computed(() => (props.picker ? props.picker.chosen : props.bot.members || []));
const composerTokens = useComposerTokens({ draft, input, group, groupBots, botId: () => props.bot.id });
const { tokens, mention, slash, skillRows, mentionRows, updateMention, insertSkill, insertMention, snapCaret, mirrorParts, withMarkers } = composerTokens;

const mirror = ref(null);
function syncMirror() {
  if (mirror.value && input.value) mirror.value.scrollTop = input.value.scrollTop;
}

function send() {
  if (!hasContent.value) return;
  // Sending always goes to the bottom, wherever the reader was.
  scrollToBottom();
  emit("send", {
    text: withMarkers(draft.value.trim()),
    quotes: [...quotes.value],
    attachments: attachments.value.map(({ name, size, type, text, path }) => ({ name, size, type, ...(text ? { text } : {}), ...(path ? { path } : {}) })),
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
  ownChat: () => (props.bot.kind !== "group" && !props.picker ? props.bot : null),
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
const { micError, dictating, calling, dictationPress, dictationRelease, toggleDictation, startCall, callFailed, callEnded } = useDictation({
  draft,
  botId: () => props.bot.id,
  focusComposer,
  voiceEnded: (seconds) => emit("voice-ended", seconds)
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
  <main class="mb-chat" aria-label="Chat">
    <!-- An open page covers the chat, which stays where it was underneath (D-74). -->
    <div ref="scroller" class="mb-chat__scroller" :class="{ 'mb-chat__scroller--covered': page }" @scroll.passive="onScroll">
      <div ref="column" class="mb-chat__column" :class="{ 'mb-chat__column--tabs': room }" :style="{ ...columnStyle, paddingBottom: `${dockHeight + 40}px` }">
        <p v-if="parentRoom" class="mb-chat__continues">
          <v-icon icon="$forkRight" size="13" />
          Continues from
          <button type="button" class="mb-chat__continues-link" @click="emit('room-select', parentRoom.id)">{{ parentRoom.title }}</button>
          and knows what was said there before it began
        </p>
        <MercbotTimeline
          :bot="bot"
          :messages="messages"
          :status="status"
          :status-mood="statusMood"
          :unread-after="unreadAfter"
          :status-bots="statusBots"
          :me="me"
          @choose="emit('choose', $event)"
          @answer="emit('answer', $event)"
          @focus-composer="focusComposer"
          @open-skill="emit('open-skill', $event)"
          @open-bot="emit('open-bot', $event)"
          @cancel-request="emit('cancel-request', $event)"
          @take-over="emit('take-over', $event)"
          @use-computer="emit('use-computer')"
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
          @undo-note="emit('undo-note', $event)"
          @open-page="emit('open-page', $event)"
        />
      </div>
    </div>

    <MercbotPageView
      v-if="page"
      :key="`${page.botId}:${page.path}`"
      :bot-id="page.botId"
      :path="page.path"
      :title="page.title"
      :group="page.group"
      :stamp="page.stamp"
      :bot-name="page.botName"
      :me="me"
      :bottom="dockHeight"
      @close="emit('close-page')"
      @toast="showToast"
      @failure="emit('failure', $event)"
    />

    <div v-if="!page" class="mb-chat__fade" :class="{ 'mb-chat__fade--tabs': room }" aria-hidden="true" />

    <MercbotGroupPicker
      v-if="picker"
      :chosen="picker.chosen"
      :candidates="picker.candidates"
      @change="emit('picker-change', $event)"
      @close="emit('picker-close')"
      @new-bot="emit('picker-new-bot', $event)"
      @start="emit('picker-start')"
    />
    <button v-else-if="!page" type="button" class="mb-chip" :aria-label="`${bot.name} details`" @click="emit('open-details')">
      <MercbotConvoAvatar :bot="bot" :size="22" still />
      <span class="mb-chip__text">
        <span class="mb-chip__name">{{ bot.name }}</span>
        <!-- A one-bot group names its bot under the group's name. -->
        <span v-if="bot.kind === 'group' && bot.members?.length === 1" class="mb-chip__tag">{{ bot.members[0].name }}</span>
      </span>
    </button>

    <MercbotRoomTabs
      v-if="room && !picker && !page"
      :rooms="bot.rooms"
      :active-id="bot.roomId"
      @select="emit('room-select', $event)"
      @create="emit('room-create', $event)"
      @rename="emit('room-rename', $event)"
    />

    <MercbotCallBar
      v-if="calling"
      :bot="bot"
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
      <!-- Scrolled up, a reply that arrives leaves the view where it is and shows in a pill instead. -->
      <div v-if="awayFromBottom && unseen && !page" class="mb-chat__to-bottom mb-new-pill" role="status">
        <button type="button" class="mb-new-pill__jump" @click="scrollToBottom('auto')">
          <v-icon icon="$arrowdown" size="16" />
          {{ unseen === 1 ? "1 new message" : `${unseen} new messages` }}
        </button>
        <button type="button" class="mb-new-pill__close" aria-label="Dismiss new messages" @click="unseen = 0">
          <v-icon icon="$close" size="14" />
        </button>
      </div>
      <div v-else-if="awayFromBottom && !page" class="mb-chat__to-bottom">
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
      <div class="mb-composer" :class="{ 'mb-composer--focused': composerFocused, 'mb-composer--stacked': stacked }">
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
              <v-list-item min-height="32" class="px-3" @click="emit('teach')">
                <template #prepend><v-icon icon="$radioOn" size="14" color="error" /></template>
                <span class="mb-composer__menu-text">Teach a task</span>
              </v-list-item>
            </v-list>
          </v-menu>
          <input ref="fileInput" type="file" multiple hidden @change="addFiles">
          <div class="mb-composer__field">
            <div v-if="tokens.length" ref="mirror" class="mb-composer__mirror" :style="{ height: inputHeight }" aria-hidden="true">
              <template v-for="(part, index) in mirrorParts" :key="index">
                <span v-if="part.token?.kind === 'skill'" class="mb-mention mb-skill-token" :style="{ color: bot.color, '--mb-token-tint': bot.color }">/{{ part.token.label }}</span>
                <span v-else-if="part.token" class="mb-mention" :style="{ color: part.token.bot ? part.token.bot.color : undefined }">
                  <span class="mb-mention__at">@<span class="mb-mention__avatar">
                    <MercbotAvatar v-if="part.token.bot" :bot="part.token.bot" :size="14" still />
                    <v-icon v-else :icon="part.token.kind === 'everyone' ? '$groupFilled' : '$alternateEmail'" size="12" />
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
              :aria-label="`Message ${bot.name}`"
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
                <span v-else class="mb-mention-menu__glyph"><v-icon :icon="row.kind === 'everyone' ? '$groupFilled' : row.kind === 'skill' ? '$menuBook' : '$extension'" size="12" /></span>
                <span class="mb-mention-menu__name">{{ row.label }}</span>
                <span v-if="row.status" class="mb-mention-menu__status">{{ row.status }}</span>
                <span class="mb-mention-menu__type">{{ row.type === "everyone" ? "bot" : row.type }}</span>
              </li>
            </ul>
          </div>
          <textarea ref="measure" class="mb-composer__measure" rows="1" tabindex="-1" aria-hidden="true" />
          <span class="mb-composer__spacer" />
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
            v-else-if="!group"
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
