<script setup>
import { computed } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import { botFace, directBotOf } from "./chatView.js";
import { useShellInitials } from "./shellInitials.js";

// A chat's avatar in the sidebar, the chat's header, details and the palette (D-112): a direct chat's bot, or a chat
// with one bot and only the person looking, as that bot's own face (with its mood); any other chat as a cluster of who's
// in it besides the person, people by their initials and bots by their faces. Two sit corner to corner, three as one on
// top and two below, four in a grid.
const props = defineProps({
  chat: { type: Object, required: true },
  me: { type: String, default: "" },
  size: { type: Number, default: 22 },
  state: { type: String, default: "idle" },
  still: { type: Boolean, default: false }
});
// A chat of no one else yet shows the person's own initials.
const myInitials = useShellInitials();

const initialsOf = (name) => {
  const words = String(name || "").trim().split(/\s+/u).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : (words[0] || "?").slice(0, 2)).toUpperCase();
};

const faces = computed(() => {
  const direct = directBotOf(props.chat);
  if (direct) return [{ key: `bot-${direct.id}`, bot: direct }];
  const people = (props.chat.people || [])
    .filter((person) => String(person.userId) !== String(props.me))
    .map((person) => ({ key: `person-${person.userId}`, initials: initialsOf(person.name), name: person.name }));
  const bots = (props.chat.bots || []).map((member) => ({ key: `bot-${member.botId}`, bot: botFace(member) }));
  const all = [...people, ...bots];
  return (all.length ? all : [{ key: "you", initials: myInitials.value, name: "" }]).slice(0, 4);
});

const places = computed(() => {
  const s = props.size;
  const count = faces.value.length;
  if (count === 1) return [{ x: 0, y: 0, d: s }];
  if (count === 2) {
    const d = Math.round(s * 0.64);
    return [{ x: 0, y: 0, d }, { x: s - d, y: s - d, d }];
  }
  if (count === 3) {
    const d = Math.round(s * 0.56);
    return [{ x: (s - d) / 2, y: 0, d }, { x: 0, y: s - d, d }, { x: s - d, y: s - d, d }];
  }
  const d = Math.round(s * 0.5);
  return [{ x: 0, y: 0, d }, { x: s - d, y: 0, d }, { x: 0, y: s - d, d }, { x: s - d, y: s - d, d }];
});
</script>

<template>
  <MercbotAvatar v-if="faces.length === 1 && faces[0].bot" :bot="faces[0].bot" :size="size" :state="state" :still="still" />
  <span v-else class="mb-chat-avatar" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <span
      v-for="(face, index) in faces"
      :key="face.key"
      class="mb-chat-avatar__face"
      :class="{ 'mb-chat-avatar__face--person': !face.bot }"
      :style="{
        left: `${places[index].x}px`,
        top: `${places[index].y}px`,
        width: `${places[index].d}px`,
        height: `${places[index].d}px`,
        fontSize: `${Math.max(7, Math.round(places[index].d * 0.38))}px`
      }"
    >
      <MercbotAvatar v-if="face.bot" :bot="face.bot" :size="places[index].d" still />
      <template v-else>{{ face.initials }}</template>
    </span>
  </span>
</template>

<style scoped>
.mb-chat-avatar {
  position: relative;
  display: inline-block;
  flex: none;
}

.mb-chat-avatar__face {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mb-chat-avatar__face--person {
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-highest));
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 700;
  line-height: 1;
}
</style>
