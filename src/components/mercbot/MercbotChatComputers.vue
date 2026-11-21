<script setup>
import { computed } from "vue";
import MercbotChatComputer from "./MercbotChatComputer.vue";

// A chat's computers (D14, D16), one per bot in it, each "<Bot>'s computer", for Chat details, or one bot's for its
// card in a direct chat (`onlyBotId`). `computerNews` counts each computer's changes ("<chatId> <botId>"), so each one's
// status is read again when it changes.
const props = defineProps({
  chat: { type: Object, required: true },
  me: { type: String, default: "" },
  homeName: { type: String, default: "this home" },
  onlyBotId: { type: String, default: "" },
  computerNews: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["open-live", "failure"]);

const members = computed(() => (props.chat.bots || [])
  .filter((bot) => !props.onlyBotId || String(bot.botId) === String(props.onlyBotId)));
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
        :news="computerNews[`${chat.id} ${member.botId}`] || 0"
        @open-live="emit('open-live', $event)"
        @failure="emit('failure', $event)"
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
