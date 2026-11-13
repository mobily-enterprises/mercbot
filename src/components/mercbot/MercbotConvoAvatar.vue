<script setup>
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotGroupAvatar from "./MercbotGroupAvatar.vue";

// The avatar of a conversation in the sidebar, chip, Details or palette: a bot's own, or a
// group's cluster.
defineProps({
  bot: { type: Object, required: true },
  size: { type: Number, default: 22 },
  state: { type: String, default: "idle" },
  still: { type: Boolean, default: false }
});
</script>

<template>
  <MercbotGroupAvatar v-if="bot.kind === 'group'" :group="bot" :size="size" />
  <MercbotAvatar v-else :bot="bot" :size="size" :state="state" :still="still" />
</template>
