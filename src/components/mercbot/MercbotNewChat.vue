<script setup>
import { computed, onMounted, ref } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotChatAvatar from "./MercbotChatAvatar.vue";
import { KIND_MEANS, chatTitle } from "./chatView.js";
import { chatsApi } from "./chatsApi.js";
import { initialsOf } from "./messageAuthors.js";

// New chat (plan 4.3, D15): who it's with (people and bots of the home), Public or Private, and an optional title. Public
// is the default whoever is on the To: line; Private is the marked other choice, and the kind can't change later. The
// composer below writes its first message, or Enter on an empty composer starts it empty. Below, the public chats the
// person isn't in yet, to join instead. Opened by Continue with others (D-114), it carries a direct chat on: its bot is
// on the To: line, the bot's hand-over note fills the composer, and it starts once someone else is on the line.
const props = defineProps({
  // { kind, people: userIds, bots: botIds, title, continuing?: { chatId, botId, writing } }
  choice: { type: Object, required: true },
  // The home's people (useTeam), the person among them, and its active bots.
  people: { type: Array, default: () => [] },
  bots: { type: Array, default: () => [] },
  me: { type: String, default: "" },
  homeName: { type: String, default: "this home" },
  starting: { type: Boolean, default: false }
});
const emit = defineEmits(["change", "close", "start", "join"]);

const query = ref("");
const input = ref(null);
const active = ref(0);

const chosenPeople = computed(() => props.choice.people.map((id) => props.people.find((person) => String(person.id) === id)).filter(Boolean));
const chosenBots = computed(() => props.choice.bots.map((id) => props.bots.find((bot) => String(bot.id) === id)).filter(Boolean));

// Who can still be added, matching what's typed: people first, then bots.
const needle = computed(() => query.value.trim().toLowerCase());
const matches = (name) => !needle.value || String(name || "").toLowerCase().includes(needle.value);
const otherPeople = computed(() => props.people.filter((person) =>
  String(person.id) !== String(props.me) && !props.choice.people.includes(String(person.id)) && matches(person.name)));
const otherBots = computed(() => props.bots.filter((bot) => !props.choice.bots.includes(String(bot.id)) && matches(bot.name)));
const suggestions = computed(() => [
  ...otherPeople.value.map((person) => ({ key: `person-${person.id}`, kind: "person", id: String(person.id), name: person.name })),
  ...otherBots.value.map((bot) => ({ key: `bot-${bot.id}`, kind: "bot", id: String(bot.id), name: bot.name, bot }))
]);


function add(entry) {
  if (entry.kind === "person") emit("change", { people: [...props.choice.people, entry.id] });
  else emit("change", { bots: [...props.choice.bots, entry.id] });
  query.value = "";
  active.value = 0;
  input.value?.focus();
}

function removePerson(id) {
  emit("change", { people: props.choice.people.filter((entry) => entry !== String(id)) });
}

function removeBot(id) {
  emit("change", { bots: props.choice.bots.filter((entry) => entry !== String(id)) });
}

function onToKeydown(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const last = suggestions.value.length - 1;
    active.value = Math.max(0, Math.min(last, active.value + (event.key === "ArrowDown" ? 1 : -1)));
  } else if (event.key === "Enter" && query.value.trim() && suggestions.value[active.value]) {
    event.preventDefault();
    add(suggestions.value[active.value]);
  } else if (event.key === "Backspace" && !query.value) {
    if (props.choice.bots.length) removeBot(props.choice.bots[props.choice.bots.length - 1]);
    else if (props.choice.people.length) removePerson(props.choice.people[props.choice.people.length - 1]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (query.value) query.value = "";
    else emit("close");
  }
}

const empty = computed(() => !props.choice.people.length && !props.choice.bots.length);
// Continuing a direct chat: its bot, and whether anyone besides it is on the To: line yet.
const continuedBot = computed(() => props.bots.find((bot) => String(bot.id) === props.choice.continuing?.botId) || null);
const alone = computed(() => Boolean(props.choice.continuing) && !props.choice.people.length &&
  props.choice.bots.every((id) => id === props.choice.continuing.botId));

// The public chats the person isn't in yet, to join instead (D12: everyone in the home can open them).
const publicChats = ref([]);
onMounted(async () => {
  input.value?.focus();
  try {
    publicChats.value = (await chatsApi.publicChats()).chats || [];
  } catch {
    publicChats.value = [];
  }
});

defineExpose({ focusTo: () => input.value?.focus() });
</script>

<template>
  <section class="mb-new-chat" aria-label="New chat">
    <header class="mb-new-chat__head">
      <h2 class="mb-new-chat__title">{{ choice.continuing ? "Continue with others" : "New chat" }}</h2>
      <v-btn icon="$close" size="32" variant="text" aria-label="Close New chat" @click="emit('close')" />
    </header>

    <div class="mb-new-chat__kinds" role="radiogroup" aria-label="Who can open it">
      <label class="mb-new-chat__kind" :class="{ 'mb-new-chat__kind--chosen': choice.kind !== 'private' }">
        <input
          type="radio"
          name="mb-new-chat-kind"
          value="public"
          :checked="choice.kind !== 'private'"
          @change="emit('change', { kind: 'public' })"
        >
        <v-icon icon="$language" size="18" class="mb-new-chat__kind-icon" />
        <span class="mb-new-chat__kind-text">
          <span class="mb-new-chat__kind-name">Public</span>
          <span class="mb-new-chat__kind-line">{{ KIND_MEANS.public(homeName) }}</span>
        </span>
      </label>
      <label class="mb-new-chat__kind" :class="{ 'mb-new-chat__kind--chosen': choice.kind === 'private' }">
        <input
          type="radio"
          name="mb-new-chat-kind"
          value="private"
          :checked="choice.kind === 'private'"
          @change="emit('change', { kind: 'private' })"
        >
        <v-icon icon="$lock" size="18" class="mb-new-chat__kind-icon" />
        <span class="mb-new-chat__kind-text">
          <span class="mb-new-chat__kind-name">Private</span>
          <span class="mb-new-chat__kind-line">{{ KIND_MEANS.private() }}</span>
        </span>
      </label>
    </div>
    <p class="mb-new-chat__fixed">You can't change this once the chat has started.</p>
    <p v-if="choice.continuing" class="mb-new-chat__continuing" role="status">
      <v-icon icon="$forkRight" size="16" />
      <span v-if="choice.continuing.writing">{{ continuedBot?.name || "The bot" }} is writing a note of your chat for the others…</span>
      <span v-else>Your chat with {{ continuedBot?.name || "the bot" }} stays as it is. The first message below is its note for the others: read it and change anything before you send it.</span>
    </p>

    <div class="mb-new-chat__to">
      <span class="mb-new-chat__label">To:</span>
      <span v-for="person in chosenPeople" :key="`person-${person.id}`" class="mb-new-chat__chip">
        <span class="mb-new-chat__initials">{{ initialsOf(person.name) }}</span>
        {{ person.name }}
        <button type="button" class="mb-new-chat__remove" :aria-label="`Remove ${person.name}`" @click="removePerson(person.id)">
          <v-icon icon="$close" size="12" />
        </button>
      </span>
      <span v-for="bot in chosenBots" :key="`bot-${bot.id}`" class="mb-new-chat__chip">
        <MercbotAvatar :bot="bot" :size="18" still />
        {{ bot.name }}
        <button type="button" class="mb-new-chat__remove" :aria-label="`Remove ${bot.name}`" @click="removeBot(bot.id)">
          <v-icon icon="$close" size="12" />
        </button>
      </span>
      <input
        ref="input"
        v-model="query"
        class="mb-new-chat__input"
        aria-label="Add people and bots"
        :placeholder="empty ? 'Type a name…' : ''"
        @keydown="onToKeydown"
        @input="active = 0"
      >
    </div>

    <div v-if="suggestions.length" class="mb-new-chat__suggestions" role="listbox" aria-label="People and bots">
      <template v-if="otherPeople.length">
        <p class="mb-new-chat__group">People</p>
        <button
          v-for="(entry, index) in suggestions.filter((row) => row.kind === 'person')"
          :key="entry.key"
          type="button"
          role="option"
          class="mb-new-chat__suggestion"
          :class="{ 'mb-new-chat__suggestion--active': query && index === active }"
          :aria-selected="query && index === active"
          @click="add(entry)"
        >
          <span class="mb-new-chat__initials">{{ initialsOf(entry.name) }}</span>
          {{ entry.name }}
        </button>
      </template>
      <template v-if="otherBots.length">
        <p class="mb-new-chat__group">Bots</p>
        <button
          v-for="(entry, index) in suggestions.filter((row) => row.kind === 'bot')"
          :key="entry.key"
          type="button"
          role="option"
          class="mb-new-chat__suggestion"
          :class="{ 'mb-new-chat__suggestion--active': query && index + otherPeople.length === active }"
          :aria-selected="query && index + otherPeople.length === active"
          @click="add(entry)"
        >
          <MercbotAvatar :bot="entry.bot" :size="18" still />
          {{ entry.name }}
        </button>
      </template>
    </div>
    <p v-else-if="query" class="mb-new-chat__none">No one in {{ homeName }} by that name.</p>

    <label class="mb-new-chat__title-field">
      <span class="mb-new-chat__label">Title (optional)</span>
      <input
        class="mb-new-chat__title-input"
        :value="choice.title"
        maxlength="120"
        placeholder="Its members' names"
        @input="emit('change', { title: $event.target.value })"
      >
    </label>

    <div class="mb-new-chat__start">
      <p class="mb-new-chat__hint">{{ alone ? "Add the people or bots to continue with." : "Write the first message below, or press Enter there to start it empty." }}</p>
      <v-btn color="primary" variant="flat" :disabled="empty || alone" :loading="starting" @click="emit('start')">Start</v-btn>
    </div>

    <div v-if="publicChats.length && !choice.continuing" class="mb-new-chat__public">
      <p class="mb-new-chat__group">Or join a public chat</p>
      <button
        v-for="chat in publicChats"
        :key="chat.id"
        type="button"
        class="mb-new-chat__public-chat"
        :aria-label="`Join ${chatTitle(chat, me)}`"
        @click="emit('join', String(chat.id))"
      >
        <MercbotChatAvatar :chat="chat" :me="me" :size="22" still />
        <span class="mb-new-chat__public-name">{{ chatTitle(chat, me) }}</span>
        <span class="mb-new-chat__public-count">{{ (chat.people || []).length }}</span>
        <span class="mb-new-chat__join">Join</span>
      </button>
    </div>
  </section>
</template>

<style scoped>
.mb-new-chat {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 24px 0 16px;
}

.mb-new-chat__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.mb-new-chat__title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}

.mb-new-chat__kinds {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

@media (max-width: 599px) {
  .mb-new-chat__kinds {
    grid-template-columns: 1fr;
  }
}

.mb-new-chat__kind {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
  cursor: pointer;
}

.mb-new-chat__kind input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.mb-new-chat__kind:focus-within {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.mb-new-chat__kind--chosen {
  border-color: rgb(var(--v-theme-primary));
  background: rgba(var(--v-theme-primary), 0.06);
}

.mb-new-chat__kind-icon {
  flex: none;
  margin-top: 1px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-new-chat__kind-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mb-new-chat__kind-name {
  font-size: 14px;
  font-weight: 600;
}

.mb-new-chat__kind-line,
.mb-new-chat__continuing {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface-variant));
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface));
}

.mb-new-chat__fixed,
.mb-new-chat__hint,
.mb-new-chat__none {
  margin: 0;
  font-size: 12px;
  line-height: 17px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-new-chat__to {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 44px;
  padding: 6px 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
}

.mb-new-chat__to:focus-within {
  border-color: rgb(var(--v-theme-primary));
}

.mb-new-chat__label {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-new-chat__chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 28px;
  padding: 0 4px 0 4px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 13px;
}

.mb-new-chat__initials {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-highest));
  font-size: 8px;
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-new-chat__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-new-chat__input,
.mb-new-chat__title-input {
  flex: 1;
  min-width: 120px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface));
  outline: none;
}

.mb-new-chat__suggestions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.mb-new-chat__group {
  flex-basis: 100%;
  margin: 4px 0 0;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-new-chat__suggestion {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 30px;
  padding: 0 10px 0 6px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 15px;
  background: none;
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}

.mb-new-chat__suggestion--active,
.mb-new-chat__suggestion:hover {
  background: rgb(var(--v-theme-surface-container-highest));
}

.mb-new-chat__title-field {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
}

.mb-new-chat__start {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.mb-new-chat__public {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-top: 8px;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
}

.mb-new-chat__public-chat {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 40px;
  padding: 0 8px;
  border: 0;
  border-radius: 10px;
  background: none;
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  text-align: left;
  cursor: pointer;
}

.mb-new-chat__public-chat:hover {
  background: rgb(var(--v-theme-surface-container-highest));
}

.mb-new-chat__public-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-new-chat__public-count {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-new-chat__join {
  font-weight: 600;
  color: rgb(var(--v-theme-link));
}
</style>
