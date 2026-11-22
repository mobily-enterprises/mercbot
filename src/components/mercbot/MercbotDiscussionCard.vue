<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import { nanoMoney } from "./accountApi.js";
import { botFace, discussionState } from "./chatView.js";
import { chatsApi } from "./chatsApi.js";

// A discussion (D-115, plan 4.5): the bots of a chat talk a question over, a round at a time, as the person who started
// it asks. Before it starts, it says what it may cost for 1, 2 or 3 rounds, from the server's estimate; Start, One more
// round and Wrap up are that person's; Stop is theirs and the chat's managers'. The server keeps the card: each press
// answers it as it now stands, and everyone in the chat hears of every change. A round's card is leased while it runs:
// once its lease lapses (the server running it stopped) it reads as interrupted, here as on the server, and waits for a
// press like a finished round. Here the lease left is counted on this page's clock from when the card came, never
// against the server's time, which a browser's clock may be ahead of.
const props = defineProps({
  message: { type: Object, required: true },
  chat: { type: Object, required: true },
  me: { type: String, default: "" },
  // Whether the person manages the home (its owners and admins), who may stop any discussion in it.
  manages: { type: Boolean, default: false }
});

// The card as the last press answered it, until the chat's own copy catches up.
const pressed = ref(null);
watch(() => props.message.body, () => { pressed.value = null; });
const body = computed(() => pressed.value?.body || props.message.body);
// When the card as it stands came, and the time now, kept every few seconds while it's shown: a running round's lease.
const arrived = ref(Date.now());
const now = ref(arrived.value);
watch(body, () => {
  arrived.value = Date.now();
  now.value = arrived.value;
});
let ticking = null;
onMounted(() => {
  ticking = setInterval(() => {
    now.value = Date.now();
  }, 5000);
});
onBeforeUnmount(() => clearInterval(ticking));
const state = computed(() => discussionState(body.value, arrived.value, now.value));
const awaitsPress = computed(() => state.value === "waiting" || state.value === "interrupted");
const mine = computed(() => String(body.value.for?.id) === String(props.me));
const mayStop = computed(() => mine.value || props.manages || String(props.chat.madeBy) === String(props.me));
// Each bot's face as the chat shows it; one gone from the chat since keeps its name.
const faces = computed(() => body.value.bots.map((bot) => botFace(props.chat.bots.find((entry) => String(entry.botId) === String(bot.id)) || { botId: bot.id, name: bot.name })));

const rounds = ref(body.value.rounds || 2);
const choice = computed(() => body.value.choices?.find((entry) => entry.rounds === rounds.value) || null);
const STATUS = { proposed: "Not started", running: "Talking", waiting: "Your turn", interrupted: "Interrupted", ended: "Ended" };
const status = computed(() => (state.value === "waiting" && !mine.value ? "Paused" : STATUS[state.value] || state.value));
const botName = (botId) => body.value.bots.find((bot) => String(bot.id) === String(botId))?.name || "A bot";
const ENDED = {
  passed: () => "Ended: no bot had anything new to add.",
  wrapped: () => `${botName(body.value.wrappedBy)} wrapped it up.`,
  stopped: () => (body.value.stoppedBy ? `${body.value.stoppedBy.name} stopped it.` : "It was stopped."),
  cancelled: () => "Cancelled before it started.",
  cap: () => "It stopped at its cost limit.",
  paused: () => "It stopped: this home is paused.",
  failed: () => "It stopped: a bot's turn didn't work."
};
const line = computed(() => {
  const spent = `${nanoMoney(body.value.spentNano)} so far`;
  const what = body.value.wrapping ? "The wrap-up" : `Round ${body.value.round} of ${body.value.rounds}`;
  const next = mine.value ? "" : ` · waiting for ${body.value.for?.name || "its starter"}`;
  if (state.value === "proposed") return choice.value ? `Up to about ${nanoMoney(choice.value.upToNano)}, as your work in this home.` : "";
  if (state.value === "running") return `${body.value.wrapping ? "Wrapping up" : what} · ${spent}`;
  if (state.value === "waiting") return `${what} done · ${spent}${next}`;
  if (state.value === "interrupted") return `${what} was interrupted · ${spent}${next}`;
  return `${(ENDED[body.value.ended] || (() => "Ended."))()} It cost ${nanoMoney(body.value.spentNano)}.`;
});
const passedLine = computed(() => (state.value !== "proposed" && body.value.passed?.length ? `Passed: ${body.value.passed.map(botName).join(", ")}` : ""));

// A press, answered with the card as it now stands; a refusal (someone else's discussion, a bot still answering) says why.
const busy = ref("");
const failure = ref("");
async function press(verb, input = {}) {
  busy.value = verb;
  failure.value = "";
  try {
    pressed.value = (await chatsApi.discussion(props.chat.id, props.message.id, verb, input)).message;
  } catch (error) {
    failure.value = error?.message || "That didn't go through. Try again.";
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <section class="mb-discussion" aria-label="Discussion">
    <div class="mb-discussion__head">
      <v-icon icon="$sms" size="18" class="mb-discussion__icon" />
      <span class="mb-discussion__title">Discussion</span>
      <span class="mb-discussion__status" :class="`mb-discussion__status--${state}`">{{ status }}</span>
    </div>
    <p class="mb-discussion__question">{{ body.question }}</p>
    <div class="mb-discussion__bots">
      <MercbotAvatar v-for="face in faces" :key="face.id" :bot="face" :size="20" still />
      <span>{{ body.bots.map((bot) => bot.name).join(", ") }}<template v-if="body.for"> · started by {{ mine ? "you" : body.for.name }}</template></span>
    </div>

    <div v-if="state === 'proposed' && mine" class="mb-discussion__rounds" role="radiogroup" aria-label="Rounds">
      <button
        v-for="entry in body.choices"
        :key="entry.rounds"
        type="button"
        role="radio"
        class="mb-discussion__round"
        :class="{ 'mb-discussion__round--on': rounds === entry.rounds }"
        :aria-checked="rounds === entry.rounds"
        @click="rounds = entry.rounds"
      >
        {{ entry.rounds }} {{ entry.rounds === 1 ? "round" : "rounds" }}
      </button>
    </div>
    <p v-if="line" class="mb-discussion__line">{{ line }}</p>
    <p v-if="passedLine" class="mb-discussion__line">{{ passedLine }}</p>
    <p v-if="state === 'proposed' && !mine" class="mb-discussion__line">Waiting for {{ body.for?.name || "its starter" }} to start it.</p>
    <p v-if="failure" class="mb-discussion__failure" role="alert">{{ failure }}</p>

    <div v-if="state !== 'ended'" class="mb-discussion__actions">
      <template v-if="state === 'proposed' && mine">
        <button type="button" class="mb-discussion__button" :disabled="Boolean(busy)" @click="press('cancel')">Cancel</button>
        <button type="button" class="mb-discussion__button mb-discussion__button--go" :disabled="Boolean(busy)" @click="press('start', { rounds })">Start</button>
      </template>
      <template v-else-if="awaitsPress && mine">
        <button type="button" class="mb-discussion__button" :disabled="Boolean(busy)" @click="press('stop')">Stop</button>
        <button v-if="body.round < body.rounds && !body.wrapping" type="button" class="mb-discussion__button" :disabled="Boolean(busy)" @click="press('round')">One more round</button>
        <button type="button" class="mb-discussion__button mb-discussion__button--go" :disabled="Boolean(busy)" @click="press('wrap')">Wrap up</button>
      </template>
      <button v-else-if="state !== 'proposed' && mayStop" type="button" class="mb-discussion__button" :disabled="Boolean(busy)" @click="press('stop')">Stop</button>
    </div>
  </section>
</template>

<style scoped>
.mb-discussion {
  max-width: 486px;
  padding: 12px 14px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-discussion__head,
.mb-discussion__bots {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mb-discussion__icon {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-discussion__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
}

.mb-discussion__status {
  flex: none;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-discussion__status--running {
  background: rgba(var(--v-theme-info), 0.12);
  color: rgb(var(--v-theme-info));
}

.mb-discussion__status--waiting,
.mb-discussion__status--interrupted {
  background: rgba(var(--v-theme-warning), 0.15);
  color: rgb(var(--v-theme-warning));
}

.mb-discussion__question {
  margin: 8px 0;
  font-size: 15px;
  line-height: 21px;
  overflow-wrap: anywhere;
}

.mb-discussion__bots {
  gap: 4px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-discussion__bots span {
  margin-left: 4px;
}

.mb-discussion__rounds {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 10px;
}

.mb-discussion__round {
  height: 30px;
  padding: 0 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 15px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mb-discussion__round--on {
  border-color: rgb(var(--v-theme-secondary));
  background: rgba(var(--v-theme-secondary), 0.12);
}

.mb-discussion__line {
  margin: 8px 0 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-discussion__failure {
  margin: 8px 0 0;
  font-size: 13px;
  color: rgb(var(--v-theme-error));
}

.mb-discussion__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 12px;
}

.mb-discussion__button {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 15px;
  background: rgb(var(--v-theme-surface-container-high));
  color: inherit;
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}

.mb-discussion__button--go {
  background: rgb(var(--v-theme-secondary));
  color: rgb(var(--v-theme-on-secondary));
}

.mb-discussion__button:disabled {
  opacity: 0.6;
  cursor: default;
}

.mb-discussion__button:focus-visible,
.mb-discussion__round:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
</style>
