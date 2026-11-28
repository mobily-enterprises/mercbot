<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MercbotAvatar from "@/components/mercbot/MercbotAvatar.vue";
import MercbotChatPanel from "@/components/mercbot/MercbotChatPanel.vue";
import { chatsApi, sleep } from "@/components/mercbot/chatsApi.js";
import { appsApi, errorText } from "./appsApi.js";
import { chipsFor, followChatNews, seesLine } from "./appBotChat.js";

// An app's chat (D-147): the person's own chat with the app's bot, beside the app (a full screen on a phone). It is the
// shell's chat view (MercbotChatPanel) on that one chat, with the screen's suggested questions as chips that fill the
// message box, and every message sent with what's on the person's screen now (`snapshot`, appSnapshot.js). News of the
// chat (a reply, a job's message) comes on the home's event stream while it's open.
const props = defineProps({
  slug: { type: String, required: true },
  // The app's bot: { name, color, shape }.
  bot: { type: Object, required: true },
  suggestions: { type: Array, default: () => [] },
  // What's on screen now, read as each message is sent.
  snapshot: { type: Function, required: true },
  me: { type: String, default: "" },
  width: { type: Number, default: 400 }
});
const emit = defineEmits(["close"]);

const chat = ref(null);
const messages = ref([]);
const draft = ref("");
const status = ref("");
const problem = ref("");
const hasOlder = ref(false);
let cursor = null;
let stopNews = null;
// Replies come after the newest message the page has (chatsApi.reply), polled while the bot is still writing.
const REPLY_POLL_MS = 1500;
const REPLY_GIVE_UP_MS = 15 * 60 * 1000;

const numeric = (message) => /^\d+$/u.test(String(message.id));
/** Messages merged in by id, the server's in their order, the page's own still sending after them. */
function merge(list) {
  const byId = new Map(messages.value.map((message) => [message.id, message]));
  for (const message of list) byId.set(message.id, message);
  const all = [...byId.values()];
  messages.value = [...all.filter(numeric).sort((a, b) => Number(a.id) - Number(b.id)), ...all.filter((message) => !numeric(message))];
}
const drop = (id) => {
  messages.value = messages.value.filter((message) => message.id !== id);
};
const latestId = () => [...messages.value].reverse().find(numeric)?.id ?? null;

/** Read as it's seen, so the chats list doesn't show it unread. */
function markRead() {
  const last = latestId();
  if (chat.value && last) chatsApi.markRead(chat.value.id, last).catch(() => {});
}

async function catchUp() {
  if (!chat.value) return;
  const page = await chatsApi.messages(chat.value.id, cursor ? { since: cursor } : {});
  if (page.cursor) cursor = page.cursor;
  merge(page.messages);
  markRead();
}

function listen() {
  stopNews = followChatNews((chatId) => {
    if (chatId === String(chat.value?.id)) catchUp().catch(() => {});
  });
}

async function start() {
  problem.value = "";
  try {
    const { chat: made } = await appsApi.botChat(props.slug);
    chat.value = (await chatsApi.get(made.id)).chat;
    const page = await chatsApi.messages(chat.value.id);
    cursor = page.cursor ?? null;
    hasOlder.value = Boolean(page.more);
    merge(page.messages);
    markRead();
    listen();
  } catch (error) {
    problem.value = errorText(error, "The chat couldn't open. Try again.");
  }
}
start();
// What goes with the next message, said in a line over the box: read again as the person types and every moment, as
// the screen changes under it.
const sees = ref("");
const SEES_EVERY_MS = 1500;
const readSees = () => {
  sees.value = seesLine(props.snapshot());
};
let seesTimer = null;
onMounted(() => {
  readSees();
  seesTimer = setInterval(readSees, SEES_EVERY_MS);
});
onBeforeUnmount(() => {
  stopNews?.();
  clearInterval(seesTimer);
});

async function loadOlder() {
  const oldest = messages.value.find(numeric);
  if (!chat.value || !oldest) return;
  const page = await chatsApi.messages(chat.value.id, { before: oldest.id });
  hasOlder.value = Boolean(page.more);
  merge(page.messages);
}

async function reply(afterMessageId) {
  status.value = "Thinking it over";
  try {
    let result = await chatsApi.reply(chat.value.id, afterMessageId);
    const giveUpAt = Date.now() + REPLY_GIVE_UP_MS;
    while (result.pending && Date.now() < giveUpAt) {
      await sleep(REPLY_POLL_MS);
      result = await chatsApi.reply(chat.value.id, afterMessageId);
    }
    merge(result.messages || []);
    markRead();
  } catch {
    merge([{ id: `error-${Date.now()}`, kind: "error", role: "system", body: { text: "Couldn't get a reply." } }]);
  } finally {
    status.value = "";
  }
}

/** A message sent with what's on screen now; the bot replies. */
async function send(payload, retryOf = null) {
  const pending = retryOf || { id: `pending-${Date.now()}`, kind: "text", role: "user", authorUserId: props.me, authorBotId: null, body: { text: payload.text } };
  merge([{ ...pending, pending: true, failed: false }]);
  let result;
  try {
    result = await chatsApi.send(chat.value.id, { ...payload, snapshot: props.snapshot(), clientId: pending.id });
  } catch {
    merge([{ ...pending, payload, pending: false, failed: true }]);
    return;
  }
  drop(pending.id);
  merge(result.messages);
  await reply(result.messages.at(-1).id);
}

function retry(message) {
  if (message.kind === "error") {
    drop(message.id);
    reply(latestId());
  } else if (message.failed) {
    send(message.payload, message);
  }
}

/** A question card answered, then the bot carries on. */
async function answer({ message, selected, repository = null }) {
  const result = await chatsApi.answer(chat.value.id, message.id, selected, repository);
  merge(result.messages);
  await reply(latestId());
}

const columnWidth = computed(() => Math.max(240, props.width - 24));
// Only while the box is empty: a chip fills it with the question, ready to change or send.
const chips = computed(() => chipsFor(draft.value, props.suggestions));
watch(draft, readSees);
watch(() => props.slug, () => {
  stopNews?.();
  chat.value = null;
  messages.value = [];
  cursor = null;
  start();
});
</script>

<template>
  <section class="app-bot-chat" :aria-label="`Chat with ${bot.name}`">
    <header class="app-bot-chat__head">
      <MercbotAvatar :bot="bot" :size="28" :state="status ? 'working' : 'idle'" />
      <div class="app-bot-chat__title">
        <span class="text-subtitle-1 font-weight-medium">{{ bot.name }}</span>
        <span class="text-caption text-medium-emphasis">Sees what's on your screen as you write. Only you see this chat.</span>
      </div>
      <v-btn icon="$close" variant="text" size="small" :aria-label="`Close the chat with ${bot.name}`" @click="emit('close')" />
    </header>
    <v-alert v-if="problem" type="error" variant="tonal" density="compact" class="ma-3">
      {{ problem }}
      <template #append><v-btn variant="text" size="small" @click="start">Try again</v-btn></template>
    </v-alert>
    <div v-else-if="!chat" class="app-bot-chat__loading"><v-progress-circular indeterminate size="28" color="primary" /></div>
    <div v-else class="app-bot-chat__body">
      <MercbotChatPanel
        v-model:draft="draft"
        bare
        :chat="chat"
        :messages="messages"
        :me="me"
        :status="status"
        :status-bots="status ? [bot] : []"
        :column-width="columnWidth"
        :has-older="hasOlder"
        :load-older="loadOlder"
        :find-older="async () => ({ count: 0, newest: null, oldest: null })"
        :load-through="async () => {}"
        :placeholder="`Ask ${bot.name} about this screen`"
        @send="send"
        @retry="retry"
        @answer="answer"
      >
        <template #notice>
          <div v-if="chips.length" class="app-bot-chat__chips" role="group" aria-label="Suggested questions">
            <v-chip v-for="question in chips" :key="question" size="small" variant="tonal" color="primary" @click="draft = question">{{ question }}</v-chip>
          </div>
          <p v-if="sees" class="app-bot-chat__sees text-body-small text-medium-emphasis">
            <v-icon icon="$visibility" size="14" aria-hidden="true" /> {{ sees }}
          </p>
        </template>
      </MercbotChatPanel>
    </div>
  </section>
</template>

<style scoped>
.app-bot-chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: rgb(var(--v-theme-background));
}
.app-bot-chat__head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 8px 10px 16px;
  border-bottom: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.app-bot-chat__title {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}
.app-bot-chat__loading {
  display: flex;
  justify-content: center;
  padding: 48px 0;
}
.app-bot-chat__body {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}
.app-bot-chat__sees {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0 6px 6px;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.app-bot-chat__chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 0 4px 8px;
}
</style>
