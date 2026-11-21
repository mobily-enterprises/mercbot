<script setup>
import { computed } from "vue";
import MercbotChatDetails from "./MercbotChatDetails.vue";
import MercbotIconButton from "./MercbotIconButton.vue";
import MercbotMemberCard from "./MercbotMemberCard.vue";
import { emitResizeDrag } from "./pointerDrag.js";

// The details beside what's shown (D-112, plan 4.2, 4.4): a member's card (on Team, and a direct chat's bot with this
// chat's computer), or Chat details for any other chat. It carries the panel's frame: its width, Close and resizing.
const props = defineProps({
  width: { type: Number, required: true },
  // { kind: "bot", bot } or { kind: "person", person } for a member's card; null for Chat details.
  member: { type: Object, default: null },
  // The chat it's shown from, or null on Team.
  chat: { type: Object, default: null },
  chats: { type: Array, default: () => [] },
  me: { type: String, default: "" },
  homeName: { type: String, default: "this home" },
  manages: { type: Boolean, default: false },
  teamBots: { type: Array, default: () => [] },
  computerNews: { type: Object, default: () => ({}) },
  mood: { type: String, default: "idle" }
});
const emit = defineEmits([
  "close", "resize", "open-page", "open-chat", "open-member", "message", "command", "changed", "failure", "notify",
  "messages", "edit-routine", "open-computer"
]);

const label = computed(() => {
  if (!props.member) return "Chat details";
  return `${props.member.kind === "bot" ? props.member.bot.name : props.member.person.name}'s card`;
});
const botCommand = (name, args = {}) => emit("command", { name, args: { botId: String(props.member.bot.id), ...args } });
</script>

<template>
  <aside class="mb-details" :style="{ width: `${width}px` }" :aria-label="label">
    <div class="mb-details__top">
      <MercbotIconButton icon="$close" label="Close details" @click="emit('close')" />
    </div>
    <MercbotMemberCard
      v-if="member"
      :key="member.kind === 'bot' ? `bot-${member.bot.id}` : `person-${member.person.id}`"
      :member="member"
      :chat="chat"
      :chats="chats"
      :me="me"
      :home-name="homeName"
      :manages="manages"
      :mood="mood"
      :all-bots="teamBots"
      :computer-news="computerNews"
      @message="emit('message', $event)"
      @open-chat="emit('open-chat', $event)"
      @open-page="emit('open-page', $event)"
      @changed="emit('changed', $event)"
      @rename="botCommand('renameBot', { name: $event })"
      @archive-bot="botCommand('archiveBot')"
      @unarchive-bot="botCommand('unarchiveBot')"
      @edit-routine="emit('edit-routine', $event)"
      @messages="emit('messages', $event)"
      @open-computer="emit('open-computer', $event)"
      @failure="emit('failure', $event)"
      @notify="emit('notify', $event)"
    />
    <div v-else-if="chat" class="mb-details__scroll">
      <MercbotChatDetails
        :key="chat.id"
        :chat="chat"
        :me="me"
        :home-name="homeName"
        :manages="manages"
        :computer-news="computerNews"
        @open-member="emit('open-member', $event)"
        @command="emit('command', $event)"
        @open-computer="emit('open-computer', $event)"
        @edit-routine="emit('edit-routine', $event)"
        @failure="emit('failure', $event)"
      />
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

<style scoped>
.mb-details {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  height: 100%;
  border-left: 1px solid rgb(var(--v-theme-outline-variant));
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
}

.mb-details__top {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px 0;
}

.mb-details__scroll {
  flex: 1;
  min-height: 0;
  padding: 4px 16px 24px;
  overflow-y: auto;
}

.mb-details__resize {
  position: absolute;
  top: 0;
  bottom: 0;
  left: -4px;
  z-index: 2;
  width: 7px;
  cursor: col-resize;
  touch-action: none;
}
</style>
