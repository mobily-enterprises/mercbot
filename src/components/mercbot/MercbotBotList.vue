<script setup>
import { nextTick, ref, watch } from "vue";
import MercbotConvoAvatar from "./MercbotConvoAvatar.vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotContextMenu from "./MercbotContextMenu.vue";
import { botMenuItems, sectionMenuItems } from "./botMenus.js";
import { useBotDrag } from "./useBotDrag.js";
import { usePriceTags } from "./usePriceTags.js";

// The expanded sidebar's bot list: pinned tiles, grouped rows, hidden bots, menus, drag and drop.
// Every change is emitted as a command for the shell to carry out.
const props = defineProps({
  model: { type: Object, required: true },
  sections: { type: Array, required: true },
  currentBotId: { type: String, default: "" },
  hints: { type: Object, default: () => ({}) },
  switchHighlightId: { type: String, default: "" },
  drafts: { type: Object, default: () => ({}) },
  moods: { type: Object, default: () => ({}) },
  hiddenExpanded: { type: Boolean, default: false },
  editingSectionId: { type: String, default: "" }
});
const emit = defineEmits(["select", "command"]);

const command = (name, args = {}) => emit("command", { name, args });
const { tagOf } = usePriceTags(() => props.moods);

// Context menu at the pointer.
const menu = ref({ open: false, target: [0, 0], items: [] });
const previewBotId = ref("");
const hoveredBotId = ref("");

// Tile and row avatars show the bot's mood; an idle bot glances at the pointer.
function moodOf(bot) {
  const mood = props.moods[bot.id] || "idle";
  return mood === "idle" && hoveredBotId.value === bot.id ? "hover" : mood;
}
const pendingDelete = ref(null);

function openMenu(event, items) {
  previewBotId.value = "";
  menu.value = { open: true, target: [event.clientX, event.clientY], items };
}

function botMenu(event, bot, place) {
  openMenu(event, botMenuItems({
    bot,
    place,
    sections: props.sections,
    model: props.model,
    command,
    startRename,
    askDelete: () => { pendingDelete.value = bot; }
  }));
}

function sectionMenu(event, section, index) {
  openMenu(event, sectionMenuItems({ section, index, count: props.sections.length, command, startRename: startSectionRename }));
}

function confirmDelete() {
  command("deleteBot", { botId: pendingDelete.value.id });
  pendingDelete.value = null;
}

// Inline rename of bots and sections: Enter commits, Escape cancels.
const renamingBotId = ref("");
const renamingSectionId = ref("");
const renameValue = ref("");

async function selectInput() {
  await nextTick();
  const input = document.querySelector(".mb-inline-name");
  input?.focus();
  input?.select();
}

function startRename(bot) {
  renamingBotId.value = bot.id;
  renameValue.value = bot.name;
  selectInput();
}

function startSectionRename(section) {
  renamingSectionId.value = section.id;
  renameValue.value = section.name;
  selectInput();
}

watch(() => props.editingSectionId, (id) => {
  const section = props.sections.find((entry) => entry.id === id);
  if (section) startSectionRename(section);
});

function commitRename() {
  const name = renameValue.value.trim();
  if (renamingBotId.value && name) command("renameBot", { botId: renamingBotId.value, name });
  if (renamingSectionId.value && name) command("renameSection", { sectionId: renamingSectionId.value, name });
  cancelRename();
}

function cancelRename() {
  renamingBotId.value = "";
  renamingSectionId.value = "";
}

function onRenameKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    commitRename();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    cancelRename();
  }
}

const { draggingBotId, dropGroupKey, tileOrder, tiles, layout, startRowDrag, startTileDrag, overTile, dropTiles, overGroup, dropOnGroup, endDrag } =
  useBotDrag({ model: () => props.model, command });

function previewText(bot) {
  const draft = bot.id !== props.currentBotId ? String(props.drafts[bot.id] || "").trim() : "";
  return draft ? { draft: true, text: draft } : { draft: false, text: bot.preview || "" };
}
</script>

<template>
  <div class="mb-list">
    <section
      v-if="tiles.length"
      class="mb-tiles"
      :class="[`mb-tiles--${layout}`, { 'mb-drop-zone': tileOrder }]"
      aria-label="Pinned bots"
      @dragover.prevent
      @drop.prevent="dropTiles"
    >
      <v-menu
        v-for="bot in tiles"
        :key="bot.id"
        :model-value="previewBotId === bot.id"
        open-on-hover
        :open-delay="300"
        :close-delay="0"
        location="end"
        :offset="4"
        :disabled="Boolean(draggingBotId) || menu.open"
        content-class="mb-popover mb-tile-preview"
        transition="mb-preview"
        @update:model-value="previewBotId = $event ? bot.id : ''"
      >
        <template #activator="{ props: previewProps }">
          <button
            v-bind="previewProps"
            type="button"
            class="mb-tile"
            :class="{
              'mb-tile--selected': bot.id === currentBotId,
              'mb-switching': bot.id === switchHighlightId,
              'mb-dragging': bot.id === draggingBotId
            }"
            :aria-current="bot.id === currentBotId ? 'page' : undefined"
            :aria-label="bot.name"
            draggable="true"
            @click="emit('select', bot.id)"
            @contextmenu.prevent="botMenu($event, bot, 'tile')"
            @mouseenter="hoveredBotId = bot.id"
            @mouseleave="hoveredBotId = ''"
            @dragstart="startTileDrag($event, bot)"
            @dragenter.prevent="overTile(bot)"
            @dragend="endDrag"
          >
            <span class="mb-tile__avatar">
              <MercbotConvoAvatar :bot="bot" :size="58" :state="moodOf(bot)" />
              <span v-if="bot.waitingTask" class="mb-badge mb-badge--unread mb-badge--waiting" aria-label="Waiting for you" />
              <span v-else-if="bot.unread" class="mb-badge mb-badge--unread" aria-label="Unread" />
              <span v-else-if="bot.isMain" class="mb-badge mb-badge--main" aria-label="Main bot">
                <v-icon icon="$starFilled" size="10" />
              </span>
            </span>
            <span class="mb-tile__name">{{ bot.name }}</span>
            <span v-if="tagOf(bot)" class="mb-tile__price" :title="tagOf(bot).hover">{{ tagOf(bot).text }}</span>
            <span v-if="bot.label" class="mb-tile__label">{{ bot.label }}</span>
            <kbd v-if="hints[bot.id]" class="mb-hint mb-hint--tile">{{ hints[bot.id] }}</kbd>
          </button>
        </template>
        <div class="mb-tile-preview__card">
          <div class="mb-tile-preview__head">
            <MercbotConvoAvatar :bot="bot" :size="14" />
            <span>{{ bot.name }}</span>
          </div>
          <p v-if="bot.preview" class="mb-tile-preview__text">{{ bot.preview }}</p>
        </div>
      </v-menu>
    </section>

    <section
      v-for="(group, groupIndex) in model.groups"
      :key="group.key"
      class="mb-group"
      :class="{ 'mb-drop-zone': dropGroupKey === group.key }"
      @dragover.prevent="overGroup(group)"
      @drop.prevent="dropOnGroup(group)"
    >
      <div v-if="group.kind === 'section'" class="mb-header-wrap">
        <input
          v-if="renamingSectionId === group.section.id"
          v-model="renameValue"
          class="mb-inline-name mb-inline-name--header"
          aria-label="Section name"
          @keydown="onRenameKeydown"
          @blur="commitRename"
        >
        <button
          v-else
          type="button"
          class="mb-header mb-header--toggle"
          :aria-expanded="!group.section.collapsed"
          @click="command('toggleSection', { section: group.section })"
          @contextmenu.prevent="sectionMenu($event, group.section, groupIndex)"
        >
          <span class="mb-header__label">{{ group.section.name }}</span>
          <span v-if="group.section.collapsed" class="mb-header__count">{{ group.bots.length }}</span>
          <v-icon class="mb-header__chevron" :icon="group.section.collapsed ? '$chevronRight' : '$expand'" size="14" />
        </button>
      </div>
      <div v-else-if="group.kind === 'unassigned'" class="mb-header-wrap">
        <span class="mb-header"><span class="mb-header__label">Unassigned</span></span>
      </div>

      <template v-if="!group.section?.collapsed">
        <p v-if="group.kind === 'section' && !group.bots.length" class="mb-empty-hint">Nothing filed yet: drop a bot in</p>
        <TransitionGroup tag="ul" name="mb-reorder" class="mb-rows">
          <li v-for="bot in group.bots" :key="bot.id">
            <button
              type="button"
              class="mb-row"
              :class="{
                'mb-row--creating': bot.creating,
                'mb-row--selected': bot.id === currentBotId,
                'mb-switching': bot.id === switchHighlightId,
                'mb-dragging': bot.id === draggingBotId
              }"
              :aria-current="bot.id === currentBotId ? 'page' : undefined"
              :aria-label="bot.name"
              draggable="true"
              :disabled="bot.creating"
              @click="emit('select', bot.id)"
              @contextmenu.prevent="!bot.creating && botMenu($event, bot, 'row')"
              @mouseenter="hoveredBotId = bot.id"
              @mouseleave="hoveredBotId = ''"
              @dragstart="startRowDrag($event, bot)"
              @dragend="endDrag"
            >
              <span v-if="bot.creating" class="mb-row__avatar mb-row__avatar--creating">
                <v-icon icon="$person" size="20" />
              </span>
              <span v-else class="mb-row__avatar">
                <MercbotConvoAvatar :bot="bot" :size="36" :state="moodOf(bot)" />
                <span v-if="bot.isMain" class="mb-badge mb-badge--main mb-badge--small" aria-label="Main bot">
                  <v-icon icon="$starFilled" size="8" />
                </span>
              </span>
              <span class="mb-row__text">
                <input
                  v-if="renamingBotId === bot.id"
                  v-model="renameValue"
                  class="mb-inline-name"
                  aria-label="Bot name"
                  @click.stop
                  @keydown="onRenameKeydown"
                  @blur="commitRename"
                >
                <span v-else class="mb-row__name">
                  {{ bot.name }}
                  <v-icon v-if="bot.sharing === 'shared'" icon="$group" size="13" class="mb-row__shared" aria-label="shared with everyone in this home" />
                </span>
                <span v-if="bot.waitingTask" class="mb-row__preview mb-row__preview--waiting">Waiting for you: {{ bot.waitingTask }}</span>
                <span v-else class="mb-row__preview">
                  <template v-if="previewText(bot).draft"><span class="mb-row__draft">Draft:</span> </template>{{ previewText(bot).text }}
                </span>
              </span>
              <span v-if="tagOf(bot)" class="mb-row__price" :title="tagOf(bot).hover">{{ tagOf(bot).text }}</span>
              <kbd v-if="hints[bot.id]" class="mb-hint">{{ hints[bot.id] }}</kbd>
              <span v-else-if="bot.waitingTask" class="mb-row__unread mb-row__unread--waiting" aria-label="Waiting for you" />
              <span v-else-if="bot.unread" class="mb-row__unread" aria-label="Unread" />
            </button>
          </li>
        </TransitionGroup>
      </template>
    </section>

    <section v-if="model.hidden.length" class="mb-group">
      <div class="mb-header-wrap">
        <button type="button" class="mb-header mb-header--toggle" :aria-expanded="hiddenExpanded" @click="command('toggleHidden')">
          <span class="mb-header__label">Hidden bots</span>
          <span v-if="!hiddenExpanded" class="mb-header__count">{{ model.hidden.length }}</span>
          <v-icon class="mb-header__chevron" :icon="hiddenExpanded ? '$expand' : '$chevronRight'" size="14" />
        </button>
      </div>
      <ul v-if="hiddenExpanded" class="mb-rows">
        <li v-for="bot in model.hidden" :key="bot.id">
          <button
            type="button"
            class="mb-row"
            :class="{ 'mb-row--selected': bot.id === currentBotId, 'mb-switching': bot.id === switchHighlightId }"
            :aria-label="bot.name"
            @click="emit('select', bot.id)"
            @contextmenu.prevent="botMenu($event, bot, 'hidden')"
          >
            <MercbotConvoAvatar :bot="bot" :size="36" />
            <span class="mb-row__text">
              <input
                v-if="renamingBotId === bot.id"
                v-model="renameValue"
                class="mb-inline-name"
                aria-label="Bot name"
                @click.stop
                @keydown="onRenameKeydown"
                @blur="commitRename"
              >
              <span v-else class="mb-row__name">{{ bot.name }}</span>
              <span class="mb-row__preview">{{ bot.preview }}</span>
            </span>
            <span v-if="tagOf(bot)" class="mb-row__price" :title="tagOf(bot).hover">{{ tagOf(bot).text }}</span>
            <kbd v-if="hints[bot.id]" class="mb-hint">{{ hints[bot.id] }}</kbd>
            <span v-else-if="bot.unread" class="mb-row__unread" aria-label="Unread" />
          </button>
        </li>
      </ul>
    </section>

    <MercbotContextMenu v-model="menu.open" :target="menu.target" :items="menu.items" />

    <MercbotConfirmDialog
      :model-value="Boolean(pendingDelete)"
      :title="pendingDelete?.kind === 'group' ? `Delete “${pendingDelete?.name}”?` : `Delete ${pendingDelete?.name}?`"
      :dim="pendingDelete?.kind === 'group'"
      :text="pendingDelete?.kind === 'group'
        ? 'This group chat and its whole history will be gone for good. Its bots aren\'t deleted and stay available on their own. This can\'t be undone.'
        : 'This bot and its whole conversation will be gone for good.'"
      @update:model-value="pendingDelete = null"
      @confirm="confirmDelete"
    />
  </div>
</template>

<style scoped src="./MercbotBotList.css"></style>

<style>
.mb-tile-preview__card {
  max-width: 240px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-tile-preview__head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.mb-tile-preview__text {
  display: -webkit-box;
  overflow: hidden;
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

/* The preview follows the tile only; leaving the tile closes it. */
.mb-tile-preview {
  border-radius: 10px !important;
  pointer-events: none;
}

.mb-preview-enter-active {
  transition: opacity 60ms ease;
}

.mb-preview-enter-from {
  opacity: 0;
}

.mb-drag-ghost {
  position: fixed;
  top: -200px;
  left: -200px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  width: 80px;
  height: 80px;
  padding-top: 8px;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-container-lowest));
  box-shadow: 0 4px 12px rgba(var(--v-theme-shadow), 0.12);
  font: 12px var(--v-font-body);
  color: rgb(var(--v-theme-on-surface));
}

.mb-drag-ghost span {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 50%;
  font-weight: 600;
}
</style>
