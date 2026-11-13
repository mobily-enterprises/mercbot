<script setup>
import { computed, ref } from "vue";
import { useTheme } from "vuetify";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotPluginLogo from "./MercbotPluginLogo.vue";
import MercbotHandoverCard from "./MercbotHandoverCard.vue";
import MercbotRequestCard from "./MercbotRequestCard.vue";
import MercbotTodoCard from "./MercbotTodoCard.vue";
import MercbotFileViewer from "./MercbotFileViewer.vue";
import MercbotPageCard from "./MercbotPageCard.vue";
import MercbotViewCard from "@/components/apps/MercbotViewCard.vue";
import MercbotViewViewer from "@/components/apps/MercbotViewViewer.vue";
import MercbotVoiceMemo from "./MercbotVoiceMemo.vue";
import MercbotDraftCard from "./MercbotDraftCard.vue";
import MercbotAppDraftCard from "../apps/MercbotAppDraftCard.vue";
import MercbotFieldRemovalCard from "../apps/MercbotFieldRemovalCard.vue";
import MercbotSecureForm from "./MercbotSecureForm.vue";
import MercbotLightbox from "./MercbotLightbox.vue";
import MercbotContextMenu from "./MercbotContextMenu.vue";
import extensions from "./extensions.js";
import { ONBOARDING_BLACK, ON_IDENTITY, PAPER } from "@/theme/palettes.js";
import { choiceColor, isBlack, mixColor, onChoiceColor } from "./accent.js";
import { mentionParts } from "./mentions.js";
import { screenshotUrl } from "./computerApi.js";
import { fileKind, fileUrl, formatSize } from "./filesApi.js";
import { renderRichText } from "./richText.js";
import { closestElement } from "@/browser.js";
import { MENU_REACTIONS, MORE_REACTIONS, QUICK_REACTIONS, messageMenuItems, pictureMenuItems, plainText, savePictureAsFile } from "./messageMenus.js";

// Conversation timeline: the messages, the status line while a bot works, and each message's hover actions.
const props = defineProps({
  bot: { type: Object, required: true },
  messages: { type: Array, required: true },
  status: { type: String, default: "" },
  statusMood: { type: String, default: "working" },
  unreadAfter: { type: String, default: null },
  statusBots: { type: Array, default: () => [] },
  // The signed-in person's id: in a shared bot's room, everyone else's messages are labelled (D-36).
  me: { type: String, default: "" }
});

// The cards a copy built on Mercbot adds, by the kind of message each shows (extensions.js).
const addedCards = new Map(extensions.messageCards.map((card) => [card.kind, card.component]));

// Group chats: each run of one bot's bubbles has its name above the first and its
// avatar beside the last; mentions show as the bot's avatar and name in its colour. In a shared
// bot's room (D-36) other people's messages run the same way, on the left, with their initial.
const theme = useTheme();
function speakerOf(message) {
  if (message?.kind !== "text") return null;
  if (message.role === "bot") return message.body.speaker || null;
  const from = message.body.from;
  return message.role === "user" && from && from.id !== props.me ? { ...from, person: true } : null;
}
const sideOf = (message) => (speakerOf(message)?.person ? "other" : message.role);
const initialOf = (speaker) => (String(speaker.name || "?").trim()[0] || "?").toUpperCase();
const sameSpeaker = (a, b) => Boolean(speakerOf(a) && speakerOf(b) && speakerOf(a).id === speakerOf(b).id);
const runStart = (index) => Boolean(speakerOf(items.value[index])) && !sameSpeaker(items.value[index - 1], items.value[index]);
const runEnd = (index) => Boolean(speakerOf(items.value[index])) && !sameSpeaker(items.value[index], items.value[index + 1]);

function labelColor(color) {
  const dark = theme.current.value.dark;
  if (isBlack(color)) return "rgb(var(--v-theme-on-surface))";
  return mixColor(color, dark ? "white" : "black", dark ? 0.25 : 0.18);
}

const tokenTint = (color) => (isBlack(color) ? "inherit" : mixColor(color, "white", 0.45));
const escapeHtml = (text) => String(text).replace(/[&<>"']/gu, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function richWithMentions(message) {
  const html = renderRichText(message.body.text);
  if (!html.includes("&lt;@")) return html;
  const mentions = message.body.mentions || [];
  return html
    .replace(/&lt;@everyone&gt;/gu, '<span class="mb-mention-chip">everyone</span>')
    .replace(/&lt;@app:([\w-]+)&gt;/gu, (_match, id) => `<span class="mb-mention-chip">@${escapeHtml(id)}</span>`)
    .replace(/&lt;@bot:(\d+)&gt;/gu, (_match, id) => {
      const bot = mentions.find((entry) => entry.id === id);
      if (!bot) return "@someone";
      const color = labelColor(bot.color);
      return `<span class="mb-mention-chip" style="color:${color}"><span class="mb-mention-chip__face" style="background:${escapeHtml(isBlack(bot.color) ? ONBOARDING_BLACK : bot.color)};--mb-face-eyes:${ON_IDENTITY}"></span>${escapeHtml(bot.name)}</span>`;
    });
}
// The commands a bot ran in one reply (D-47) open to show each script and its output. Lines
// saved before commands were grouped carry a single `command`.
const commandsOf = (message) => message.body.commands || (message.body.command ? [message.body.command] : null);
const openCommands = ref(new Set());
function toggleCommand(id) {
  const next = new Set(openCommands.value);
  if (!next.delete(id)) next.add(id);
  openCommands.value = next;
}

const emit = defineEmits(["take-over", "use-computer", "secure-form", "settle-draft", "manage-rules", "settle-handover", "choose", "answer", "focus-composer", "connect", "react", "reply", "copy", "copy-image", "retry", "open-skill", "undo-note", "open-bot", "cancel-request", "open-page"]);

// Right-click menus: on a message, Reply, Copy and Copy request ID, with a bot's adding a
// row of reactions; on a picture, copy or save it. Selected words and links keep the browser's own
// menu, so a part of a message can still be copied. `message` is the bot message the reactions are for.
const contextMenu = ref({ open: false, target: [0, 0], items: [], reactions: [], message: null });
function openMessageMenu(event, message) {
  if (message.pending || message.failed || closestElement(event.target, "a[href]")) return;
  if (window.getSelection()?.toString().trim()) return;
  event.preventDefault();
  contextMenu.value = {
    open: true,
    target: [event.clientX, event.clientY],
    items: messageMenuItems(message, { reply: (chosen) => emit("reply", chosen), copy: (copied) => emit("copy", copied) }),
    reactions: message.role === "bot" ? MENU_REACTIONS : [],
    message
  };
}
// Picking the reaction already chosen takes it off.
function reactFromMenu(emoji) {
  const { message } = contextMenu.value;
  emit("react", { message, emoji: message.body.reactions?.user === emoji ? null : emoji });
}
// The picture is the one right-clicked, as it shows; it's saved under `fileName`.
function openPictureMenu(event, fileName) {
  event.preventDefault();
  const picture = { src: event.currentTarget.src, fileName };
  contextMenu.value = {
    open: true,
    target: [event.clientX, event.clientY],
    items: pictureMenuItems(picture, { copyPicture: (src) => emit("copy-image", src), savePicture: savePictureAsFile }),
    reactions: [],
    message: null
  };
}

// A skill link in a bot reply opens that skill; a page named by its path opens the page (D-74).
function clickRich(event, message) {
  const page = closestElement(event.target, "[data-page]");
  if (page) {
    event.preventDefault();
    emit("open-page", { path: page.dataset.page, botId: ownerOf(message), group: placeOf(message) });
    return;
  }
  const link = closestElement(event.target, "[data-skill]");
  if (!link) return;
  event.preventDefault();
  emit("open-skill", link.dataset.skill);
}

// Screenshots from the bot's computer: skeleton until loaded, then a lightbox.
const loadedShots = ref({});
const lightbox = ref(null);
// A secure form the bot asked for, open in its dialog.
const secureForm = ref(null);
const secureFormOpen = computed({ get: () => Boolean(secureForm.value), set: (value) => { if (!value) secureForm.value = null; } });
function answerSecureForm(answer) {
  const message = secureForm.value;
  secureForm.value = null;
  emit("secure-form", { message, answer });
}

// Files the bot saved (D-20): a card each, opening the viewer. Pages open in place of the chat (D-74).
const viewing = ref(null);
const viewingView = ref(null);
// What a bot made in a group is its own (D-46): its files and screenshots are reached through it,
// in its folder for everyone when other people are in the group, and from its computer for the group.
const ownerOf = (message) => String(message.body?.speaker?.id || props.bot.id);
const placeOf = (message) => (props.bot.kind === "group" && message.body?.place === "group" ? String(props.bot.id) : null);
const shotGroup = computed(() => (props.bot.kind === "group" ? String(props.bot.id) : null));
// A card in a group waits for the person whose request made it; others see whom (D-46).
const waitingFor = (message) => (message.body?.for && String(message.body.for.id) !== props.me ? message.body.for.name : "");

// Question cards: chosen badges take the bot's colour, black bots use blue.
const badgeColor = computed(() => choiceColor(props.bot.color));
const onBadgeColor = computed(() => onChoiceColor(props.bot.color));
const picks = ref({});

function chosenList(message) {
  return [].concat(message.body.chosen || []);
}

function isOpen(message) {
  return !message.body.chosen && !message.body.inactive;
}

function clickOption(message, option) {
  if (!isOpen(message)) return;
  if (message.body.purpose === "bot-name") {
    emit("choose", option);
  } else if (!message.body.multi) {
    emit("answer", { message, selected: [option] });
  } else {
    const current = picks.value[message.id] || [];
    picks.value = {
      ...picks.value,
      [message.id]: current.includes(option) ? current.filter((entry) => entry !== option) : [...current, option]
    };
  }
}

function isPicked(message, option) {
  return chosenList(message).includes(option) || (picks.value[message.id] || []).includes(option);
}

function shownOptions(message) {
  const options = message.body.options.map((option, index) => ({ option, letter: LETTERS[index] }));
  return message.body.chosen ? options.filter((entry) => chosenList(message).includes(entry.option)) : options;
}

const LETTERS = ["A", "B", "C", "D", "E"];
const GAP_MS = 20 * 60 * 1000;
const dayTime = new Intl.DateTimeFormat(undefined, { weekday: "long", hour: "numeric", minute: "2-digit" });
const todayTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function stampText(iso) {
  const date = new Date(iso);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return `Today ${todayTime.format(date)}`;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${todayTime.format(date)}`;
  return dayTime.format(date);
}

// A timestamp goes above any message that follows a long gap, and the "new" divider
// above the first message the person hadn't seen when they opened the bot.
const firstUnreadId = computed(() => {
  if (props.unreadAfter === null) return null;
  const after = Number(props.unreadAfter);
  return props.messages.find((message) => message.role !== "user" && message.kind !== "timestamp" && Number(message.id) > after)?.id ?? null;
});

const items = computed(() => {
  const result = [];
  let previous = null;
  for (const message of props.messages) {
    if (message.id === firstUnreadId.value) result.push({ id: `new-${message.id}`, kind: "new-divider", body: {} });
    const gap = previous && message.createdAt && previous.createdAt
      ? new Date(message.createdAt) - new Date(previous.createdAt)
      : 0;
    if (gap >= GAP_MS && message.kind !== "timestamp") {
      result.push({ id: `stamp-${message.id}`, kind: "gap-stamp", body: { text: stampText(message.createdAt) } });
    }
    result.push(message);
    previous = message;
  }
  return result;
});

function spacing(index) {
  const current = items.value[index];
  const previous = items.value[index - 1];
  if (!previous) return "first";
  if (previous.kind === "gap-stamp") return "after-stamp";
  const sameTurn = previous.kind === "text" && current.kind === "text" && previous.role === current.role &&
    (!speakerOf(current) || sameSpeaker(previous, current));
  return sameTurn ? "same-turn" : "turn";
}

const fileDay = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
const fileDate = (iso) => (iso ? fileDay.format(new Date(iso)) : "");
</script>

<template>
  <div class="mb-timeline">
    <div
      v-for="(message, index) in items"
      :key="message.id"
      :data-message-id="message.id"
      class="mb-timeline__item"
      :class="`mb-timeline__item--${spacing(index)}`"
    >
      <p v-if="message.kind === 'timestamp'" class="mb-timeline__centred">
        {{ stampText(message.body.at) }}
      </p>

      <p v-else-if="message.kind === 'new-divider'" class="mb-timeline__new" role="separator">new</p>

      <p v-else-if="message.kind === 'event' && message.body.name" class="mb-timeline__centred">
        {{ message.body.text }}
        <v-icon v-if="message.body.icon === 'routine'" icon="$schedule" size="12" class="mb-timeline__event-icon mb-timeline__event-icon--inline" />
        <v-icon v-else-if="message.body.icon === 'voice'" icon="$graphicEq" size="12" class="mb-timeline__event-icon mb-timeline__event-icon--inline" />
        {{ message.body.name }}
      </p>

      <div v-else-if="message.kind === 'event' && commandsOf(message)" class="mb-timeline__centred mb-command">
        <button type="button" class="mb-command__toggle" :aria-expanded="openCommands.has(message.id)" @click="toggleCommand(message.id)">
          <v-icon icon="$terminal" size="12" class="mb-timeline__event-icon" />
          {{ message.body.text }}
          <v-icon :icon="openCommands.has(message.id) ? '$collapse' : '$expand'" size="14" />
        </button>
        <template v-if="openCommands.has(message.id)">
          <pre v-for="(command, commandIndex) in commandsOf(message)" :key="commandIndex" class="mb-command__detail"><span class="mb-command__why">{{ command.why }}{{ command.exitCode ? ` (exit ${command.exitCode})` : "" }}</span>
<span class="mb-command__script">{{ command.script }}</span>{{ command.output ? `\n\n${command.output}` : "" }}</pre>
        </template>
      </div>

      <p v-else-if="message.kind === 'gap-stamp' || message.kind === 'event'" class="mb-timeline__centred">
        <v-icon v-if="message.body.icon === 'routine'" icon="$schedule" size="12" class="mb-timeline__event-icon" />
        <v-icon v-else-if="message.body.icon === 'command'" icon="$terminal" size="12" class="mb-timeline__event-icon" />
        {{ message.body.text }}
        <!-- A calendar change links to the event in its own app. -->
        <a v-if="message.body.link" :href="message.body.link" target="_blank" rel="noopener" class="mb-timeline__event-link">
          <MercbotPluginLogo v-if="message.body.app" :plugin="message.body.app" :size="14" />
          {{ message.body.linkText || "Open" }}
        </a>
      </p>

      <!-- A line noted for the home notebook (D-36), which its person can undo. -->
      <p v-else-if="message.kind === 'note'" class="mb-timeline__centred mb-timeline__note">
        <v-icon icon="$book2" size="12" class="mb-timeline__event-icon" />
        <template v-if="message.body.removed">Taken out of the notebook</template>
        <template v-else>
          Noted for {{ message.body.home }}: “{{ message.body.text }}”
          <button type="button" class="mb-timeline__retry" @click="emit('undo-note', message)">Undo</button>
        </template>
      </p>

      <p v-else-if="message.kind === 'error'" class="mb-timeline__error" role="alert">
        {{ message.body.text }}
        <button type="button" class="mb-timeline__retry" @click="emit('retry', message)">Try again</button>
      </p>

      <div
        v-else-if="message.kind === 'text'"
        class="mb-message"
        :class="[`mb-message--${sideOf(message)}`, {
          'mb-message--reacted': message.body.reactions?.[message.role === 'bot' ? 'user' : 'bot'],
          'mb-message--speaker': speakerOf(message),
          'mb-message--labelled': runStart(index)
        }]"
        @contextmenu="openMessageMenu($event, message)"
      >
        <span v-if="runStart(index)" class="mb-speaker" :style="speakerOf(message).person ? null : { color: labelColor(speakerOf(message).color) }">{{ speakerOf(message).name }}</span>
        <span v-if="runEnd(index)" class="mb-speaker__avatar">
          <span v-if="speakerOf(message).person" class="mb-speaker__initial" aria-hidden="true">{{ initialOf(speakerOf(message)) }}</span>
          <MercbotAvatar v-else :bot="speakerOf(message)" :size="24" still />
        </span>
        <div class="mb-bubble" :class="[`mb-bubble--${sideOf(message)}`, { 'mb-bubble--pending': message.pending, 'mb-bubble--group-user': bot.kind === 'group' && message.role === 'user' }]">
          <p v-if="message.body.replyTo" class="mb-bubble__quote">{{ message.body.replyTo.text }}</p>
          <p v-for="quote in message.body.quotes || []" :key="quote" class="mb-bubble__quote">{{ quote }}</p>
          <template v-for="file in message.body.attachments || []" :key="file.name">
            <!-- A picture the person sent shows as itself. -->
            <span v-if="file.path && /^image\//u.test(file.type || '')" class="mb-bubble__frame">
              <img
                class="mb-bubble__picture"
                :src="fileUrl(bot.id, file.path, { download: false })"
                :alt="file.name"
                @contextmenu.stop="openPictureMenu($event, file.name)"
              >
            </span>
            <div v-else class="mb-bubble__file">
              <v-icon :icon="fileKind(file.name).icon" size="14" />
              <span class="mb-bubble__file-name">{{ file.name }}</span>
              <span class="mb-bubble__file-size">{{ formatSize(file.size) }}</span>
            </div>
          </template>
          <template v-if="message.body.bullets">
            <p class="mb-bubble__text">{{ message.body.heading }}</p>
            <ul class="mb-bubble__bullets">
              <li v-for="bullet in message.body.bullets" :key="bullet">{{ bullet }}</li>
            </ul>
          </template>
          <!-- eslint-disable-next-line vue/no-v-html -- markdown-it escapes raw HTML (html: false) -->
          <div v-else-if="message.role === 'bot'" class="mb-rich" @click="clickRich($event, message)" v-html="richWithMentions(message)" />
          <p v-else-if="message.body.text" class="mb-bubble__text">
            <template v-for="(part, partIndex) in mentionParts(message.body.text, message.body.mentions, message.body.skills)" :key="partIndex">
              <span v-if="part.bot" class="mb-bubble__mention" :style="{ color: tokenTint(part.bot.color) }">
                <MercbotAvatar :bot="part.bot" :size="14" still />{{ part.bot.name }}
              </span>
              <span v-else-if="part.everyone" class="mb-bubble__mention"><v-icon icon="$groupFilled" size="14" />everyone</span>
              <span v-else-if="part.app" class="mb-bubble__mention">@{{ part.app }}</span>
              <span v-else-if="part.skill" class="mb-bubble__mention"><v-icon icon="$menuBook" size="14" />{{ part.skill }}</span>
              <template v-else>{{ part.text }}</template>
            </template>
          </p>
          <span v-if="message.body.chip" class="mb-bubble__chip">
            <v-icon icon="$deployedCode" size="13" />{{ message.body.chip }}
          </span>

          <span v-if="message.role === 'bot' && message.body.reactions?.user" class="mb-reaction mb-reaction--right">
            {{ message.body.reactions.user }}
          </span>
          <span v-if="message.role === 'user' && message.body.reactions?.bot" class="mb-reaction" :class="sideOf(message) === 'other' ? 'mb-reaction--right' : 'mb-reaction--left'">
            {{ message.body.reactions.bot }}
          </span>
        </div>

        <div v-if="!message.pending && !message.failed" class="mb-actions">
          <v-menu v-if="message.role === 'bot'" location="bottom" :offset="4" content-class="mb-popover mb-react-popover">
            <template #activator="{ props: reactProps }">
              <v-btn v-bind="reactProps" icon="$mood" size="22" variant="text" density="comfortable" class="mb-action" aria-label="React" />
            </template>
            <div class="mb-react">
              <button
                v-for="emoji in QUICK_REACTIONS"
                :key="emoji"
                type="button"
                class="mb-react__emoji"
                :class="{ 'mb-react__emoji--chosen': message.body.reactions?.user === emoji }"
                :aria-label="`React with ${emoji}`"
                @click="emit('react', { message, emoji: message.body.reactions?.user === emoji ? null : emoji })"
              >
                {{ emoji }}
              </button>
              <v-menu location="bottom" :offset="4" content-class="mb-popover mb-react-popover">
                <template #activator="{ props: moreProps }">
                  <button v-bind="moreProps" type="button" class="mb-react__emoji" aria-label="More reactions">
                    <v-icon icon="$addReaction" size="18" />
                  </button>
                </template>
                <div class="mb-react">
                  <button
                    v-for="emoji in MORE_REACTIONS"
                    :key="emoji"
                    type="button"
                    class="mb-react__emoji"
                    :aria-label="`React with ${emoji}`"
                    @click="emit('react', { message, emoji })"
                  >
                    {{ emoji }}
                  </button>
                </div>
              </v-menu>
            </div>
          </v-menu>
          <v-btn icon="$reply" size="22" variant="text" density="comfortable" class="mb-action" aria-label="Reply" @click="emit('reply', message)" />
          <v-menu location="bottom" :offset="4" content-class="mb-popover">
            <template #activator="{ props: moreProps }">
              <v-btn v-bind="moreProps" icon="$moreHoriz" size="22" variant="text" density="comfortable" class="mb-action" aria-label="More" />
            </template>
            <v-list density="compact" class="py-1" width="200">
              <v-list-item min-height="32" class="px-3" @click="emit('copy', { text: plainText(message), what: 'Message' })">
                <span class="mb-menu-text">Copy</span>
              </v-list-item>
              <v-list-item min-height="32" class="px-3" @click="emit('copy', { text: `req_${message.id}`, what: 'Request ID' })">
                <span class="mb-menu-text">Copy request ID</span>
              </v-list-item>
            </v-list>
          </v-menu>
        </div>
        <p v-if="message.failed" class="mb-message__failed">
          Not sent.
          <button type="button" class="mb-timeline__retry" @click="emit('retry', message)">Try again</button>
        </p>
      </div>

      <section
        v-else-if="message.kind === 'choice'"
        class="mb-card mb-choice"
        :class="{ 'mb-choice--answered': message.body.chosen, 'mb-choice--inactive': message.body.inactive }"
        :style="{ '--mb-choice': badgeColor, '--mb-on-choice': onBadgeColor }"
      >
        <p class="mb-choice__question">{{ message.body.question }}</p>
        <p v-if="message.body.subline" class="mb-choice__subline">{{ message.body.subline }}</p>
        <p v-if="waitingFor(message) && isOpen(message)" class="mb-choice__subline">Waiting for {{ waitingFor(message) }}'s OK</p>
        <div v-if="!waitingFor(message) || !isOpen(message)" class="mb-choice__options">
          <button
            v-for="entry in shownOptions(message)"
            :key="entry.option"
            type="button"
            class="mb-choice__option"
            :class="{ 'mb-choice__option--picked': isPicked(message, entry.option) }"
            :disabled="!isOpen(message)"
            :aria-pressed="message.body.multi ? isPicked(message, entry.option) : undefined"
            @click="clickOption(message, entry.option)"
          >
            <span class="mb-choice__badge">{{ entry.letter }}</span>
            <span>{{ entry.option }}</span>
          </button>
          <button
            v-if="message.body.openOption && isOpen(message)"
            type="button"
            class="mb-choice__option mb-choice__option--open"
            @click="emit('focus-composer')"
          >
            <span class="mb-choice__badge">{{ LETTERS[message.body.options.length] }}</span>
            <span>{{ message.body.openOption }}</span>
          </button>
        </div>
        <div v-if="message.body.multi && isOpen(message)" class="mb-choice__done">
          <button
            type="button"
            class="mb-choice__done-button"
            :disabled="!(picks[message.id] || []).length"
            @click="emit('answer', { message, selected: picks[message.id] })"
          >
            Done
          </button>
        </div>
      </section>

      <div
        v-else-if="message.kind === 'screenshots'"
        class="mb-shots"
        :class="{ 'mb-shots--single': message.body.images.length === 1 }"
      >
        <button
          v-for="image in message.body.images"
          :key="image.name"
          type="button"
          class="mb-shot"
          :aria-label="`Open screenshot: ${image.caption}`"
          @click="lightbox = { src: screenshotUrl(ownerOf(message), image.name, shotGroup), caption: image.caption, fileName: image.name }"
        >
          <img
            :src="screenshotUrl(ownerOf(message), image.name, shotGroup)"
            :alt="image.caption"
            :class="{ 'mb-shot__img--loaded': loadedShots[image.name] }"
            @load="loadedShots = { ...loadedShots, [image.name]: true }"
            @contextmenu="openPictureMenu($event, image.name)"
          >
        </button>
      </div>

      <MercbotDraftCard v-else-if="message.kind === 'draft'" :key="`${message.id}-${message.body.status}`" :message="message" :waiting-for="waitingFor(message)" @settle="(answer, onFail) => emit('settle-draft', { message, answer, onFail })" @manage-rules="emit('manage-rules')" />

      <MercbotAppDraftCard v-else-if="message.kind === 'app_draft'" :message="message" />
      <MercbotFieldRemovalCard v-else-if="message.kind === 'field_removal'" :message="message" />
      <MercbotVoiceMemo v-else-if="message.kind === 'voice'" :bot-id="ownerOf(message)" :group="placeOf(message)" :memo="message.body" />

      <div v-else-if="message.kind === 'pictures'" class="mb-pictures">
        <button
          v-for="image in message.body.images"
          :key="image.path"
          type="button"
          class="mb-pictures__open"
          :aria-label="`Open picture: ${image.title}`"
          @click="lightbox = { src: fileUrl(ownerOf(message), image.path, { download: false, group: placeOf(message) }), caption: image.caption, fileName: `${image.title}.png` }"
        >
          <img
            :src="fileUrl(ownerOf(message), image.path, { download: false, group: placeOf(message) })"
            :alt="image.caption"
            @contextmenu="openPictureMenu($event, `${image.title}.png`)"
          >
        </button>
      </div>

      <figure v-else-if="message.kind === 'chart'" class="mb-chart">
        <button
          type="button"
          class="mb-chart__open"
          :style="{ background: PAPER }"
          :aria-label="`Open chart: ${message.body.title}`"
          @click="lightbox = { src: fileUrl(ownerOf(message), message.body.path, { download: false, group: placeOf(message) }), caption: message.body.caption, fileName: `${message.body.title}.png` }"
        >
          <img
            :src="fileUrl(ownerOf(message), message.body.path, { download: false, group: placeOf(message) })"
            :alt="message.body.caption"
            @contextmenu="openPictureMenu($event, `${message.body.title}.png`)"
          >
        </button>
      </figure>

      <!-- A page deleted from the Library keeps its card, which no longer opens. -->
      <MercbotPageCard
        v-else-if="message.kind === 'page'"
        :bot-id="ownerOf(message)"
        :page="message.body"
        @open="emit('open-page', { path: message.body.path, botId: ownerOf(message), group: placeOf(message) })"
      />

      <MercbotViewCard v-else-if="message.kind === 'view'" :message="message" @open="viewingView = $event" />

      <div v-else-if="message.kind === 'files'" class="mb-files">
        <button
          v-for="file in message.body.files"
          :key="file.path"
          type="button"
          class="mb-files__card"
          :aria-label="`Open ${file.name}`"
          @click="viewing = { ...file, owner: ownerOf(message), group: placeOf(message) }"
        >
          <span class="mb-files__icon"><v-icon :icon="fileKind(file.name).icon" size="22" /></span>
          <span class="mb-files__text">
            <span class="mb-files__name">{{ file.name }}</span>
            <span class="mb-files__meta">{{ fileKind(file.name).label }} · {{ formatSize(file.size) }}</span>
          </span>
        </button>
      </div>

      <!-- Files in the person's own Drive or OneDrive, listed or just made. -->
      <ul v-else-if="message.kind === 'drive_files'" class="mb-drive-files" :aria-label="`Files in ${message.body.account}`">
        <li v-for="file in message.body.files" :key="file.id || file.link" class="mb-drive-files__row">
          <MercbotPluginLogo :plugin="message.body.app" :size="16" />
          <a :href="file.link" target="_blank" rel="noopener" class="mb-drive-files__name">{{ file.name }}</a>
          <span class="mb-drive-files__meta">{{ [file.kind, fileDate(file.modified)].filter(Boolean).join(" · ") }}</span>
        </li>
      </ul>

      <section v-else-if="message.kind === 'secure_form'" class="mb-secure-card" :aria-label="`Secure form for ${message.body.site}`">
        <span class="mb-secure-card__icon"><v-icon icon="$key" size="18" /></span>
        <span class="mb-secure-card__text">
          <span class="mb-secure-card__title">{{ message.body.form === "code" ? `Code for ${message.body.site}` : `Sign in to ${message.body.site}` }}</span>
          <span class="mb-secure-card__status">{{ message.body.status === "submitted" ? "Submitted ✓" : message.body.status === "closed" ? "Closed" : "Your bot never sees what you type" }}</span>
        </span>
        <button v-if="message.body.status === 'pending'" type="button" class="mb-set-pill mb-set-pill--dark" @click="secureForm = message">Open</button>
      </section>

      <MercbotTodoCard v-else-if="message.kind === 'todos'" :message="message" />

      <MercbotRequestCard
        v-else-if="message.kind === 'bot_request'"
        :message="message"
        @open-bot="emit('open-bot', $event)"
        @cancel="emit('cancel-request', $event)"
      />

      <MercbotHandoverCard
        v-else-if="message.kind === 'handover'"
        :bot="bot"
        :message="message"
        :me="me"
        @take-over="emit('take-over', message)"
        @settle="emit('settle-handover', { message, outcome: $event })"
      />

      <!-- A kind of card a copy built on Mercbot adds (extensions.js). -->
      <component :is="addedCards.get(message.kind)" v-else-if="addedCards.has(message.kind)" :message="message" :bot="bot" />

      <template v-else-if="message.kind === 'connect'">
        <section class="mb-card mb-connect">
          <MercbotPluginLogo v-if="message.body.plugin" :plugin="message.body.plugin" :size="40" />
          <span v-else class="mb-connect__logo"><v-icon icon="$mail" size="24" /></span>
          <span class="mb-connect__text">
            <span class="mb-connect__app">
              {{ message.body.app }}
              <v-icon icon="$verified" size="14" class="mb-connect__verified" aria-label="Verified" />
            </span>
            <span class="mb-connect__subtitle">{{ message.body.subtitle }}</span>
          </span>
          <!-- Connected from this card: the bot carries on with the task by itself. -->
          <span v-if="message.body.status === 'connected'" class="mb-connect__done"><v-icon icon="$check" size="16" />Connected</span>
          <button v-else type="button" class="mb-connect__button" :class="{ 'mb-connect__button--dark': message.body.button }" @click="emit('connect', message)">{{ message.body.button || "Connect" }}</button>
        </section>
        <p class="mb-connect__footnote">{{ message.body.footnote }}</p>
      </template>
    </div>

    <MercbotContextMenu
      v-model="contextMenu.open"
      :target="contextMenu.target"
      :items="contextMenu.items"
      :reactions="contextMenu.reactions"
      :chosen-reaction="contextMenu.message?.body.reactions?.user || null"
      @react="reactFromMenu"
    />
    <MercbotLightbox
      v-if="lightbox"
      :src="lightbox.src"
      :caption="lightbox.caption"
      :file-name="lightbox.fileName"
      @close="lightbox = null"
    />
    <MercbotSecureForm
      v-if="secureForm"
      v-model="secureFormOpen"
      :site="secureForm.body.site"
      :form="secureForm.body.form"
      @submit="answerSecureForm({ action: 'submit', ...$event })"
      @close="answerSecureForm({ action: 'close' })"
    />
    <MercbotViewViewer v-if="viewingView" :slug="viewingView.path" :title="viewingView.title" @close="viewingView = null" />
    <MercbotFileViewer
      v-if="viewing"
      :bot-id="viewing.owner || String(bot.id)"
      :group="viewing.group"
      :file="viewing"
      @close="viewing = null"
      @opened="viewing = null; emit('use-computer')"
    />

    <div v-if="status" class="mb-timeline__item mb-timeline__item--turn mb-status" role="status">
      <span v-if="statusBots.length" class="mb-status__group">
        <span v-for="worker in statusBots" :key="worker.id" class="mb-status__member">
          <MercbotAvatar :bot="worker" :size="25" state="working" />
        </span>
      </span>
      <MercbotAvatar v-else :bot="bot" :size="25" :state="statusMood" />
      <span class="mb-status__text">{{ status }}</span>
    </div>
  </div>
</template>

<style scoped src="./MercbotTimeline.css"></style>
<style scoped src="./MercbotTimelineCards.css"></style>
