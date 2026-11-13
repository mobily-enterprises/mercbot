<script setup>
import { computed } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import { useShellInitials } from "./shellInitials.js";

// A group's avatar: every participant, the person first as a grey circle with their
// initials. Two sit corner to corner, three as one on top and two below, four or more in a grid.
const props = defineProps({
  group: { type: Object, required: true },
  size: { type: Number, default: 36 }
});
const initials = useShellInitials();

const places = computed(() => {
  const bots = (props.group.members || []).slice(0, 3);
  const count = bots.length + 1;
  const s = props.size;
  if (count <= 2) {
    const d = Math.round(s * 0.64);
    return [{ x: 0, y: 0, d }, { x: s - d, y: s - d, d }].slice(0, count);
  }
  if (count === 3) {
    const d = Math.round(s * 0.56);
    return [{ x: (s - d) / 2, y: 0, d }, { x: 0, y: s - d, d }, { x: s - d, y: s - d, d }];
  }
  const d = Math.round(s * 0.5);
  return [{ x: 0, y: 0, d }, { x: s - d, y: 0, d }, { x: 0, y: s - d, d }, { x: s - d, y: s - d, d }];
});
const bots = computed(() => (props.group.members || []).slice(0, places.value.length - 1));
</script>

<template>
  <span class="mb-group-avatar" :style="{ width: `${size}px`, height: `${size}px` }" aria-hidden="true">
    <span
      class="mb-group-avatar__person"
      :style="{ left: `${places[0].x}px`, top: `${places[0].y}px`, width: `${places[0].d}px`, height: `${places[0].d}px`, fontSize: `${Math.max(7, Math.round(places[0].d * 0.38))}px` }"
    >{{ initials }}</span>
    <span
      v-for="(bot, index) in bots"
      :key="bot.id"
      class="mb-group-avatar__bot"
      :style="{ left: `${places[index + 1].x}px`, top: `${places[index + 1].y}px` }"
    >
      <MercbotAvatar :bot="bot" :size="places[index + 1].d" still />
    </span>
  </span>
</template>

<style scoped>
.mb-group-avatar {
  position: relative;
  display: inline-block;
  flex: none;
}

.mb-group-avatar__person,
.mb-group-avatar__bot {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
}

.mb-group-avatar__person {
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-highest));
  color: rgb(var(--v-theme-on-surface-variant));
  font-weight: 700;
  line-height: 1;
}
</style>
