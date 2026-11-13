<script setup>
import { nextTick, ref, watch } from "vue";
import MercbotIconButton from "./MercbotIconButton.vue";

// A shared bot's conversations as named tabs (D-36), under the header chip. "+" names a new one,
// which continues from the open tab; double-clicking a tab renames it. Every tab has a name.
const props = defineProps({
  rooms: { type: Array, required: true },
  activeId: { type: String, default: null }
});
const emit = defineEmits(["select", "create", "rename"]);

const LIMIT = 40;
const scroller = ref(null);
const adding = ref(false);
const editing = ref("");
const draft = ref("");
// The one name field showing, for a new tab or a rename.
let field = null;
const setField = (element) => {
  if (element) field = element;
};
const active = () => props.rooms.find((room) => room.id === props.activeId) || props.rooms[0];

async function focusField() {
  await nextTick();
  field?.focus();
  field?.select();
}

function startAdding() {
  editing.value = "";
  draft.value = "";
  adding.value = true;
  focusField();
}

function startRenaming(room) {
  adding.value = false;
  editing.value = room.id;
  draft.value = room.title;
  focusField();
}

function stop() {
  adding.value = false;
  editing.value = "";
  draft.value = "";
}

// Enter with no name keeps the field open: a tab always has a name.
function enter() {
  if (draft.value.trim()) commit();
}

function commit() {
  const title = draft.value.replace(/\s+/gu, " ").trim();
  if (adding.value && title) emit("create", title);
  const room = props.rooms.find((entry) => entry.id === editing.value);
  if (room && title && title !== room.title) emit("rename", { id: room.id, title });
  stop();
}

// The open tab stays in view when there are more than fit.
watch(() => props.activeId, async () => {
  await nextTick();
  scroller.value?.querySelector("[aria-selected='true']")?.scrollIntoView({ block: "nearest", inline: "nearest" });
}, { immediate: true });
</script>

<template>
  <nav class="mb-tabs" aria-label="Conversations">
    <div ref="scroller" class="mb-tabs__row" role="tablist">
      <template v-for="room in rooms" :key="room.id">
        <input
          v-if="editing === room.id"
          :ref="setField"
          v-model="draft"
          class="mb-tabs__field"
          :size="Math.max(draft.length, 4)"
          :maxlength="LIMIT"
          :aria-label="`New name for ${room.title}`"
          @keydown.enter.prevent="enter"
          @keydown.esc.prevent="stop"
          @blur="commit"
        >
        <button
          v-else
          type="button"
          role="tab"
          class="mb-tabs__tab"
          :aria-selected="room.id === active()?.id"
          :title="`${room.title} · double-click to rename`"
          @click="emit('select', room.id)"
          @dblclick="startRenaming(room)"
        >
          {{ room.title }}
          <span v-if="room.unread && room.id !== active()?.id" class="mb-tabs__dot" aria-label="new messages" />
        </button>
      </template>
      <input
        v-if="adding"
        :ref="setField"
        v-model="draft"
        class="mb-tabs__field"
        :size="Math.max(draft.length, 12)"
        :maxlength="LIMIT"
        placeholder="Name it"
        aria-label="Name the new conversation"
        @keydown.enter.prevent="enter"
        @keydown.esc.prevent="stop"
        @blur="commit"
      >
    </div>
    <MercbotIconButton
      icon="$add"
      label="New conversation"
      :tooltip="`New conversation, starting from what “${active()?.title}” knows`"
      size="x-small"
      :icon-size="15"
      tone="bare"
      @mousedown.prevent
      @click="startAdding"
    />
  </nav>
</template>

<style scoped>
.mb-tabs {
  position: absolute;
  top: 56px;
  left: 50%;
  display: flex;
  align-items: center;
  gap: 2px;
  max-width: min(680px, calc(100% - 32px));
  transform: translateX(-50%);
}

.mb-tabs__row {
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: none;
  mask-image: linear-gradient(to right, transparent, black 12px, black calc(100% - 12px), transparent);
  padding: 0 10px;
}

.mb-tabs__row::-webkit-scrollbar {
  display: none;
}

.mb-tabs__tab {
  position: relative;
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 30px;
  padding: 0 10px;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  font: inherit;
  font-size: 13px;
  white-space: nowrap;
  cursor: pointer;
  transition: color 120ms ease;
}

.mb-tabs__tab:hover {
  color: rgb(var(--v-theme-on-surface));
}

.mb-tabs__tab[aria-selected="true"] {
  color: rgb(var(--v-theme-on-surface));
  font-weight: 500;
}

.mb-tabs__tab[aria-selected="true"]::after {
  content: "";
  position: absolute;
  right: 10px;
  bottom: 2px;
  left: 10px;
  height: 2px;
  border-radius: 1px;
  background: rgb(var(--v-theme-primary));
}

.mb-tabs__tab:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: -2px;
  border-radius: 8px;
}

.mb-tabs__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-link));
}

.mb-tabs__field {
  flex: none;
  height: 26px;
  margin: 2px 4px;
  padding: 0 8px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 13px;
}

.mb-tabs__field:focus {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 0;
}
</style>
