<script setup>
import { nextTick, ref, watch } from "vue";
import MercbotArchivedList from "./MercbotArchivedList.vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotContextMenu from "./MercbotContextMenu.vue";
import MercbotIconButton from "./MercbotIconButton.vue";
import { archiveQuestion, archivedLabel, tabMenuItems } from "./archiveConversation.js";

// A shared bot's conversations as named tabs (D-36), under the header chip. "+" names a new one,
// which continues from the open tab; double-clicking a tab renames it. Every tab has a name. The last,
// "You only", is the person's own conversation with the bot (D-99): locked, never renamed, and a tab made
// from it starts empty. A tab's menu (right-click, or a long press on a phone) holds Rename and Archive, which asks
// first; the strip ends with Archived (N) while the person sees archived conversations, listing them to resume (D-101).
const props = defineProps({
  rooms: { type: Array, required: true },
  activeId: { type: String, default: null },
  botId: { type: String, required: true },
  // How many of the bot's conversations the person sees archived.
  archived: { type: Number, default: 0 }
});
const emit = defineEmits(["select", "create", "rename", "archive", "resume"]);

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
  if (room.own) return;
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

// A tab's menu at the pointer, and the question before archiving.
const menu = ref({ open: false, target: [0, 0], items: [] });
const archiving = ref(null);
const question = () => (archiving.value ? archiveQuestion(archiving.value) : null);
const archivedOpen = ref(false);

function openMenu(room, [x, y]) {
  const items = tabMenuItems(room, { rename: startRenaming, archive: (chosen) => { archiving.value = chosen; } });
  if (items.length) menu.value = { open: true, target: [x, y], items };
}

// A long press on a phone opens the same menu; the tap that ends it then selects nothing.
const HOLD_MS = 500;
let hold = null;
let held = false;
function pressStart(event, room) {
  held = false;
  if (event.pointerType !== "touch") return;
  const at = [event.clientX, event.clientY];
  clearTimeout(hold);
  hold = setTimeout(() => {
    held = true;
    openMenu(room, at);
  }, HOLD_MS);
}
function pressEnd() {
  clearTimeout(hold);
}
function choose(room) {
  if (held) {
    held = false;
    return;
  }
  emit("select", room.id);
}

function confirmArchive() {
  const room = archiving.value;
  archiving.value = null;
  if (room) emit("archive", room.id);
}

function resume(roomId) {
  archivedOpen.value = false;
  emit("resume", roomId);
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
          :title="room.own ? 'Only you see this conversation' : `${room.title} · double-click to rename`"
          @click="choose(room)"
          @dblclick="startRenaming(room)"
          @contextmenu.prevent="openMenu(room, [$event.clientX, $event.clientY])"
          @pointerdown="pressStart($event, room)"
          @pointerup="pressEnd"
          @pointercancel="pressEnd"
          @pointerleave="pressEnd"
        >
          <v-icon v-if="room.own" icon="$lock" size="13" class="mb-tabs__lock" />
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
      :tooltip="active()?.own ? 'New conversation for everyone, starting empty' : `New conversation, starting from what “${active()?.title}” knows`"
      size="x-small"
      :icon-size="15"
      tone="bare"
      @mousedown.prevent
      @click="startAdding"
    />
    <v-menu
      v-if="archivedLabel(archived)"
      v-model="archivedOpen"
      location="bottom end"
      :close-on-content-click="false"
      content-class="mb-popover"
    >
      <template #activator="{ props: archivedProps }">
        <button v-bind="archivedProps" type="button" class="mb-tabs__archived">
          <v-icon icon="$archive" size="14" />
          {{ archivedLabel(archived) }}
        </button>
      </template>
      <div class="mb-tabs__archived-list">
        <p class="mb-tabs__archived-title">Archived conversations</p>
        <MercbotArchivedList :bot-id="botId" :count="archived" @resume="resume" />
      </div>
    </v-menu>
    <MercbotContextMenu v-model="menu.open" :target="menu.target" :items="menu.items" />
    <MercbotConfirmDialog
      :model-value="Boolean(archiving)"
      :title="question()?.title || ''"
      :text="question()?.text || ''"
      :confirm-label="question()?.confirmLabel"
      :danger="false"
      @update:model-value="!$event && (archiving = null)"
      @confirm="confirmArchive"
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
  /* A long press opens the tab's menu, not the phone's own. */
  -webkit-touch-callout: none;
  user-select: none;
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

.mb-tabs__lock {
  margin-right: -1px;
  opacity: 0.8;
}

.mb-tabs__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-link));
}

.mb-tabs__archived {
  flex: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 26px;
  padding: 0 8px;
  border: 0;
  border-radius: 13px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  font: inherit;
  font-size: 12px;
  white-space: nowrap;
  cursor: pointer;
}

.mb-tabs__archived:hover,
.mb-tabs__archived[aria-expanded="true"] {
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface));
}

.mb-tabs__archived:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: -2px;
}

.mb-tabs__archived-list {
  width: min(340px, calc(100vw - 32px));
  padding: 8px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface));
}

.mb-tabs__archived-title {
  margin: 4px 10px 6px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 12px;
  font-weight: 500;
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
