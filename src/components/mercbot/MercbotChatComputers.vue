<script setup>
import { computed, inject, ref, watch } from "vue";
import MercbotChatComputer from "./MercbotChatComputer.vue";
import { computerApi } from "./computerApi.js";
import { MERCBOT_CHAT_KEY } from "./shellChat.js";

// A chat's computers (D14, D16), one per bot in it, each "<Bot>'s computer", for Chat details, or one bot's for its
// card in a direct chat (`onlyBotId`). Each one's status is read when it's shown and again when `computerNews` (the
// shell's count per computer, "<chatId> <botId>") says it changed; Hand back is sent here, and its line shown in the chat.
const props = defineProps({
  chat: { type: Object, required: true },
  me: { type: String, default: "" },
  homeName: { type: String, default: "this home" },
  onlyBotId: { type: String, default: "" },
  computerNews: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["open-live", "failure"]);
/** @type {import("./shellChat.js").ShellChat} */
const shellChat = inject(MERCBOT_CHAT_KEY);

const members = computed(() => (props.chat.bots || [])
  .filter((bot) => !props.onlyBotId || String(bot.botId) === String(props.onlyBotId)));
const target = (botId) => ({ id: String(botId), chat: String(props.chat.id) });

// Each computer's status by bot id, "failed" when it didn't load.
const statuses = ref({});
const handingBack = ref("");
async function read(botId) {
  try {
    const status = await computerApi.status(target(botId));
    statuses.value = { ...statuses.value, [botId]: status };
  } catch (error) {
    statuses.value = { ...statuses.value, [botId]: "failed" };
    emit("failure", error);
  }
}
// The news count each computer was last read at.
const readAt = new Map();
watch(() => members.value.map((bot) => [String(bot.botId), props.computerNews[`${props.chat.id} ${bot.botId}`] || 0]), (pairs) => {
  for (const [botId, news] of pairs) {
    if (readAt.get(botId) === news) continue;
    readAt.set(botId, news);
    read(botId);
  }
}, { immediate: true });

async function handBack({ botId, chatId }) {
  handingBack.value = botId;
  try {
    const result = await computerApi.handBack(target(botId));
    shellChat.appendMessages(chatId, result.messages || []);
    await read(botId);
  } catch (error) {
    shellChat.reportFailure("That didn't hand back. Try again.", error);
  } finally {
    handingBack.value = "";
  }
}
</script>

<template>
  <section class="mb-chat-computers" aria-label="Computers">
    <p v-if="!members.length" class="mb-chat-computers__none">No bots in this chat, so no computers.</p>
    <ul v-else class="mb-chat-computers__list">
      <MercbotChatComputer
        v-for="member in members"
        :key="member.botId"
        :chat="chat"
        :member="member"
        :me="me"
        :home-name="homeName"
        :status="statuses[String(member.botId)] === 'failed' ? null : statuses[String(member.botId)] || null"
        :failed="statuses[String(member.botId)] === 'failed'"
        :handing-back="handingBack === String(member.botId)"
        @open-live="emit('open-live', $event)"
        @hand-back="handBack"
      />
    </ul>
  </section>
</template>

<style scoped>
.mb-chat-computers__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mb-chat-computers__none {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
