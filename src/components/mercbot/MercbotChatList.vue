<script setup>
import { computed, nextTick, ref, watch } from "vue";
import MercbotChatAvatar from "./MercbotChatAvatar.vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotContextMenu from "./MercbotContextMenu.vue";
import MercbotSidebarRow from "./MercbotSidebarRow.vue";
import { leftLine } from "./archiveBot.js";
import { chatMenuItems, chatQuestion, sectionMenuItems } from "./chatMenus.js";
import { chatTitle, isDirect, kindIcon, kindLabel, previewLine, waitingTaskOf } from "./chatView.js";
import { initialsOf } from "./messageAuthors.js";
import { useChatDrag } from "./useChatDrag.js";

// The expanded sidebar's list (D-112, plan 4.1): pinned tiles, then Rooms, People and Bots, each folding by its title
// and with its + (New room; a copy's Invite people, extensions.js peopleActions; Add bots), then hidden and archived
// rooms. Rows are one line (MercbotSidebarRow): a room shows its members' faces, its name, and a globe or a lock; a
// person their initials and name; a bot its live face, name and template's name. Rooms the person isn't in are faded,
// under "N more public rooms" when there are more than three; past seven, people and bots neither added nor talked with
// lately go under "N more". Menus, drag and drop for rooms and tiles. Every change is emitted as a command for the
// shell to carry out.
const props = defineProps({
  model: { type: Object, required: true },
  sections: { type: Array, required: true },
  currentChatId: { type: String, default: "" },
  me: { type: String, default: "" },
  manages: { type: Boolean, default: false },
  hints: { type: Object, default: () => ({}) },
  switchHighlightId: { type: String, default: "" },
  drafts: { type: Object, default: () => ({}) },
  moods: { type: Object, default: () => ({}) },
  hiddenExpanded: { type: Boolean, default: false },
  archivedExpanded: { type: Boolean, default: false },
  editingSectionId: { type: String, default: "" },
  // Rooms, People and Bots each folded ({ rooms, people, bots }).
  folded: { type: Object, default: () => ({}) },
  // People's +, when a copy built on Mercbot gives one (extensions.js peopleActions) and the person may use it.
  peopleActions: { type: Array, default: () => [] },
  homeName: { type: String, default: "" }
});
const emit = defineEmits(["select", "command", "new-room", "add-bots", "open-member"]);

const command = (name, args = {}) => emit("command", { name, args });
const titleOf = (chat) => chatTitle(chat, props.me);

// Context menu at the pointer.
const menu = ref({ open: false, target: [0, 0], items: [] });
const previewChatId = ref("");
const hoveredChatId = ref("");

// A chat's face shows its bot's mood; an idle bot glances at the pointer.
function moodOf(chat) {
  const mood = props.moods[chat.id] || "idle";
  return mood === "idle" && hoveredChatId.value === chat.id ? "hover" : mood;
}

// Archive, Leave and Delete ask first: { action, chat } while one is asked.
const asking = ref(null);
const question = () => (asking.value ? chatQuestion(asking.value.action, asking.value.chat, titleOf(asking.value.chat)) : null);
const ASKED = { archive: "archiveChat", leave: "leaveChat", remove: "deleteChat" };
function confirmAsked() {
  command(ASKED[asking.value.action], { chatId: asking.value.chat.id });
  asking.value = null;
}

function openMenu(event, items) {
  previewChatId.value = "";
  menu.value = { open: true, target: [event.clientX, event.clientY], items };
}

function chatMenu(event, chat, place) {
  openMenu(event, chatMenuItems({
    chat,
    place,
    sections: props.sections,
    me: props.me,
    manages: props.manages,
    command,
    startRename,
    askDelete: () => { asking.value = { action: "remove", chat }; },
    askLeave: () => { asking.value = { action: "leave", chat }; },
    askArchive: () => { asking.value = { action: "archive", chat }; }
  }));
}

function sectionMenu(event, section, index) {
  openMenu(event, sectionMenuItems({ section, index, count: props.sections.length, command, startRename: startSectionRename }));
}

// Inline rename of chats and sections: Enter commits, Escape cancels.
const renamingChatId = ref("");
const renamingSectionId = ref("");
const renameValue = ref("");

async function selectInput() {
  await nextTick();
  const input = document.querySelector(".mb-inline-name");
  input?.focus();
  input?.select();
}

function startRename(chat) {
  renamingChatId.value = chat.id;
  renameValue.value = chat.title || "";
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
  if (renamingChatId.value) command("renameChat", { chatId: renamingChatId.value, title: name || null });
  if (renamingSectionId.value && name) command("renameSection", { sectionId: renamingSectionId.value, name });
  cancelRename();
}

function cancelRename() {
  renamingChatId.value = "";
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

const { draggingChatId, dropGroupKey, tileOrder, tiles, layout, startRowDrag, startTileDrag, overTile, dropTiles, overGroup, dropOnGroup, endDrag } =
  useChatDrag({ model: () => props.model, command, titleOf });

function previewText(chat) {
  const draft = chat.id !== props.currentChatId ? String(props.drafts[chat.id] || "").trim() : "";
  return draft ? { draft: true, text: draft } : { draft: false, text: previewLine(chat, props.me) };
}

// What a row is called to a screen reader: its name, and Private for a private room.
const rowLabel = (chat) => (chat.kind === "private" && !isDirect(chat) && !chat.directPerson ? `${titleOf(chat)}, private` : titleOf(chat));
// What a row says on hover and to a screen reader as its description: its full name, then what it waits for, its
// draft or its latest message.
function rowTip(chat) {
  if (!chat) return "";
  const waiting = waitingTaskOf(chat);
  const { draft, text } = previewText(chat);
  const line = waiting ? `Waiting for you: ${waiting}` : draft ? `Draft: ${text}` : text;
  return line ? `${titleOf(chat)}\n${line}` : titleOf(chat);
}
const hasDraft = (chat) => Boolean(chat) && previewText(chat).draft;
const entryName = (entry) => (entry.entry === "bot" ? entry.bot.name : entry.person.name);
// A person's or bot's description: as its chat's row says it, then a bot's template and its line.
const entryTip = (entry) => [entry.chat ? rowTip(entry.chat) : entryName(entry), entry.templateLine].filter(Boolean).join("\n");
const entryMood = (entry) => (entry.chat ? moodOf(entry.chat) : hoveredChatId.value === entry.id ? "hover" : "idle");

// A person's or a bot's row with a direct chat already has its menu: Pin, Mark as read or unread, Copy chat ID, Leave.
function entryMenu(event, entry) {
  if (entry.chat) chatMenu(event, entry.chat, "direct");
}

// People shows while the home has someone else, or while a copy's + lets the person invite someone.
const peopleShown = computed(() => props.model.people.count > 0 || props.peopleActions.length > 0);
const SECTIONS = computed(() => [
  { key: "people", title: "People", section: props.model.people, shown: peopleShown.value },
  { key: "bots", title: "Bots", section: props.model.bots, shown: true }
]);
</script>

<template>
  <div class="mb-list">
    <section
      v-if="tiles.length"
      class="mb-tiles"
      :class="[`mb-tiles--${layout}`, { 'mb-drop-zone': tileOrder }]"
      aria-label="Pinned chats"
      @dragover.prevent
      @drop.prevent="dropTiles"
    >
      <v-menu
        v-for="chat in tiles"
        :key="chat.id"
        :model-value="previewChatId === chat.id"
        open-on-hover
        :open-delay="300"
        :close-delay="0"
        location="end"
        :offset="4"
        :disabled="Boolean(draggingChatId) || menu.open"
        content-class="mb-popover mb-tile-preview"
        transition="mb-preview"
        @update:model-value="previewChatId = $event ? chat.id : ''"
      >
        <template #activator="{ props: previewProps }">
          <button
            v-bind="previewProps"
            type="button"
            class="mb-tile"
            :class="{
              'mb-tile--selected': chat.id === currentChatId,
              'mb-switching': chat.id === switchHighlightId,
              'mb-dragging': chat.id === draggingChatId
            }"
            :aria-current="chat.id === currentChatId ? 'page' : undefined"
            :aria-label="rowLabel(chat)"
            :draggable="!chat.everyone"
            @click="emit('select', chat.id)"
            @contextmenu.prevent="chatMenu($event, chat, 'tile')"
            @mouseenter="hoveredChatId = chat.id"
            @mouseleave="hoveredChatId = ''"
            @dragstart="startTileDrag($event, chat)"
            @dragenter.prevent="overTile(chat)"
            @dragend="endDrag"
          >
            <span class="mb-tile__avatar">
              <MercbotChatAvatar :chat="chat" :me="me" :size="58" :state="moodOf(chat)" />
              <span v-if="waitingTaskOf(chat)" class="mb-badge mb-badge--unread mb-badge--waiting" aria-label="Waiting for you" />
              <span v-else-if="chat.mentioned" class="mb-badge mb-badge--mention" aria-label="Mentioned you">@</span>
              <span v-else-if="chat.unread" class="mb-badge mb-badge--unread" aria-label="Unread" />
            </span>
            <span class="mb-tile__name">
              <v-icon v-if="!isDirect(chat) && !chat.directPerson" :icon="kindIcon(chat)" size="11" class="mb-kind" :aria-label="kindLabel(chat)" />
              {{ titleOf(chat) }}
            </span>
            <kbd v-if="hints[chat.id]" class="mb-hint mb-hint--tile">{{ hints[chat.id] }}</kbd>
          </button>
        </template>
        <div class="mb-tile-preview__card">
          <div class="mb-tile-preview__head">
            <MercbotChatAvatar :chat="chat" :me="me" :size="14" />
            <span>{{ titleOf(chat) }}</span>
          </div>
          <p v-if="previewLine(chat, me)" class="mb-tile-preview__text">{{ previewLine(chat, me) }}</p>
        </div>
      </v-menu>
    </section>

    <!-- Rooms: the person's own by section, then the public ones they aren't in, faded. -->
    <section class="mb-section" aria-label="Rooms">
      <div class="mb-section__head">
        <button type="button" class="mb-section__title" :aria-expanded="!folded.rooms" @click="command('foldSection', { section: 'rooms' })">
          <span class="mb-section__label">Rooms</span>
          <span v-if="folded.rooms && model.rooms.hiddenCount" class="mb-header__count">{{ model.rooms.hiddenCount }}</span>
        </button>
        <v-btn icon="$add" variant="text" size="small" density="comfortable" aria-label="New room" @click="emit('new-room')" />
      </div>

      <div
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
            <span v-if="group.section.collapsed" class="mb-header__count">{{ group.chats.length }}</span>
            <v-icon class="mb-header__chevron" :icon="group.section.collapsed ? '$chevronRight' : '$expand'" size="14" />
          </button>
        </div>
        <div v-else-if="group.kind === 'unassigned'" class="mb-header-wrap">
          <span class="mb-header"><span class="mb-header__label">Unassigned</span></span>
        </div>

        <template v-if="!group.section?.collapsed">
          <p v-if="group.kind === 'section' && !group.chats.length" class="mb-empty-hint">Nothing filed yet: drop a room in</p>
          <TransitionGroup tag="ul" name="mb-reorder" class="mb-rows">
            <li v-for="chat in group.chats" :key="chat.id">
              <MercbotSidebarRow
                :label="rowLabel(chat)"
                :name="titleOf(chat)"
                :tip="rowTip(chat)"
                :kind-icon="kindIcon(chat)"
                :kind-label="kindLabel(chat)"
                :selected="chat.id === currentChatId"
                :switching="chat.id === switchHighlightId"
                :dragging="chat.id === draggingChatId"
                :hint="hints[chat.id]"
                :draft="hasDraft(chat)"
                :waiting="waitingTaskOf(chat)"
                :mentioned="chat.mentioned"
                :unread="chat.unread"
                draggable="true"
                @click="emit('select', chat.id)"
                @contextmenu.prevent="chatMenu($event, chat, 'row')"
                @mouseenter="hoveredChatId = chat.id"
                @mouseleave="hoveredChatId = ''"
                @dragstart="startRowDrag($event, chat)"
                @dragend="endDrag"
              >
                <MercbotChatAvatar :chat="chat" :me="me" :size="24" :state="moodOf(chat)" />
                <template v-if="renamingChatId === chat.id" #name>
                  <input
                    v-model="renameValue"
                    class="mb-inline-name"
                    aria-label="Chat name"
                    placeholder="Its members' names"
                    @click.stop
                    @keydown="onRenameKeydown"
                    @blur="commitRename"
                  >
                </template>
              </MercbotSidebarRow>
            </li>
          </TransitionGroup>
        </template>
      </div>

      <ul v-if="model.rooms.faded.length || model.rooms.fadedMore || (model.rooms.fadedCount > 3 && !folded.rooms)" class="mb-rows">
        <li v-if="model.rooms.fadedMore">
          <button type="button" class="mb-more" :aria-expanded="false" @click="command('toggleMore', { section: 'rooms' })">
            {{ model.rooms.fadedMore }} more public {{ model.rooms.fadedMore === 1 ? "room" : "rooms" }}
          </button>
        </li>
        <li v-for="chat in model.rooms.faded" :key="chat.id">
          <MercbotSidebarRow
            :label="rowLabel(chat)"
            :name="titleOf(chat)"
            :tip="`${rowTip(chat)}\nYou're not in it yet: opening it joins you.`"
            :kind-icon="kindIcon(chat)"
            :kind-label="kindLabel(chat)"
            :selected="chat.id === currentChatId"
            :switching="chat.id === switchHighlightId"
            :hint="hints[chat.id]"
            faded
            @click="emit('select', chat.id)"
          >
            <MercbotChatAvatar :chat="chat" :me="me" :size="24" still />
          </MercbotSidebarRow>
        </li>
        <li v-if="model.rooms.fadedCount > 3 && !model.rooms.fadedMore && !folded.rooms">
          <button type="button" class="mb-more" :aria-expanded="true" @click="command('toggleMore', { section: 'rooms' })">Show fewer</button>
        </li>
      </ul>
      <button v-if="model.rooms.empty" type="button" class="mb-foot" @click="emit('new-room')">+ New room</button>
    </section>

    <!-- People and Bots: each one's direct chat, made when first opened. -->
    <template v-for="part in SECTIONS" :key="part.key">
      <section v-if="part.shown" class="mb-section" :aria-label="part.title">
        <div class="mb-section__head">
          <button type="button" class="mb-section__title" :aria-expanded="!folded[part.key]" @click="command('foldSection', { section: part.key })">
            <span class="mb-section__label">{{ part.title }}</span>
            <span v-if="folded[part.key] && part.section.hiddenCount" class="mb-header__count">{{ part.section.hiddenCount }}</span>
          </button>
          <template v-if="part.key === 'people'">
            <component :is="action.component" v-for="(action, at) in peopleActions" :key="at" :home-name="homeName" />
          </template>
          <v-btn v-else icon="$add" variant="text" size="small" density="comfortable" aria-label="Add bots" @click="emit('add-bots')" />
        </div>
        <ul class="mb-rows">
          <li v-for="entry in [...part.section.shown, ...(part.section.moreOpen ? part.section.more : [])]" :key="entry.id">
            <MercbotSidebarRow
              :label="entryName(entry)"
              :name="entryName(entry)"
              :detail="entry.templateName"
              :tip="entryTip(entry)"
              :selected="Boolean(entry.chat) && entry.chat.id === currentChatId"
              :switching="entry.id === switchHighlightId"
              :hint="hints[entry.id]"
              :draft="hasDraft(entry.chat)"
              :waiting="entry.chat ? waitingTaskOf(entry.chat) : ''"
              :mentioned="entry.mentioned"
              :unread="entry.unread"
              @click="emit('select', entry.id)"
              @contextmenu.prevent="entryMenu($event, entry)"
              @mouseenter="hoveredChatId = entry.id"
              @mouseleave="hoveredChatId = ''"
            >
              <MercbotAvatar v-if="entry.entry === 'bot'" :bot="entry.bot" :size="24" :state="entryMood(entry)" />
              <span v-else class="mb-face" aria-hidden="true">{{ initialsOf(entry.person.name) }}</span>
            </MercbotSidebarRow>
          </li>
          <li v-if="part.section.more.length">
            <button type="button" class="mb-more" :aria-expanded="part.section.moreOpen" @click="command('toggleMore', { section: part.key })">
              {{ part.section.moreOpen ? "Show fewer" : `${part.section.more.length} more` }}
            </button>
          </li>
        </ul>
        <button v-if="part.key === 'bots' && !part.section.count" type="button" class="mb-foot" @click="emit('add-bots')">+ Add bots</button>

        <!-- Bots that have left: each opens its card, where whoever may resumes it. -->
        <template v-if="part.key === 'bots' && part.section.archived.length && !folded.bots">
          <button type="button" class="mb-more" :aria-expanded="part.section.archivedOpen" @click="command('toggleMore', { section: 'archivedBots' })">
            Archived bots<span v-if="!part.section.archivedOpen" class="mb-header__count"> {{ part.section.archived.length }}</span>
          </button>
          <ul v-if="part.section.archivedOpen" class="mb-rows" aria-label="Archived bots">
            <li v-for="bot in part.section.archived" :key="bot.id">
              <MercbotSidebarRow
                :label="`${bot.name}, archived`"
                :name="bot.name"
                :tip="`${bot.name}\n${leftLine(bot)}`"
                faded
                @click="emit('open-member', `bot:${bot.id}`)"
              >
                <MercbotAvatar :bot="bot" :size="24" still />
              </MercbotSidebarRow>
            </li>
          </ul>
        </template>
      </section>
    </template>

    <section v-if="model.hidden.length" class="mb-group">
      <div class="mb-header-wrap">
        <button type="button" class="mb-header mb-header--toggle" :aria-expanded="hiddenExpanded" @click="command('toggleHidden')">
          <span class="mb-header__label">Hidden chats</span>
          <span v-if="!hiddenExpanded" class="mb-header__count">{{ model.hidden.length }}</span>
          <v-icon class="mb-header__chevron" :icon="hiddenExpanded ? '$expand' : '$chevronRight'" size="14" />
        </button>
      </div>
      <ul v-if="hiddenExpanded" class="mb-rows">
        <li v-for="chat in model.hidden" :key="chat.id">
          <MercbotSidebarRow
            :label="rowLabel(chat)"
            :name="titleOf(chat)"
            :tip="rowTip(chat)"
            :selected="chat.id === currentChatId"
            :switching="chat.id === switchHighlightId"
            :hint="hints[chat.id]"
            :mentioned="chat.mentioned"
            :unread="chat.unread"
            @click="emit('select', chat.id)"
            @contextmenu.prevent="chatMenu($event, chat, 'hidden')"
          >
            <MercbotChatAvatar :chat="chat" :me="me" :size="24" />
            <template v-if="renamingChatId === chat.id" #name>
              <input
                v-model="renameValue"
                class="mb-inline-name"
                aria-label="Chat name"
                @click.stop
                @keydown="onRenameKeydown"
                @blur="commitRename"
              >
            </template>
          </MercbotSidebarRow>
        </li>
      </ul>
    </section>

    <!-- Archived chats: read-only for everyone in them, collapsed until opened, last in the list. -->
    <section v-if="model.archived.length" class="mb-group" aria-label="Archived chats">
      <div class="mb-header-wrap">
        <button type="button" class="mb-header mb-header--toggle" :aria-expanded="archivedExpanded" @click="command('toggleArchived')">
          <span class="mb-header__label">Archived chats</span>
          <span v-if="!archivedExpanded" class="mb-header__count">{{ model.archived.length }}</span>
          <v-icon class="mb-header__chevron" :icon="archivedExpanded ? '$expand' : '$chevronRight'" size="14" />
        </button>
      </div>
      <ul v-if="archivedExpanded" class="mb-rows">
        <li v-for="chat in model.archived" :key="chat.id">
          <MercbotSidebarRow
            :label="`${titleOf(chat)}, archived`"
            :name="titleOf(chat)"
            :tip="`${titleOf(chat)}\nArchived · read-only`"
            :selected="chat.id === currentChatId"
            :switching="chat.id === switchHighlightId"
            :hint="hints[chat.id]"
            faded
            @click="emit('select', chat.id)"
            @contextmenu.prevent="chatMenu($event, chat, 'archived')"
          >
            <MercbotChatAvatar :chat="chat" :me="me" :size="24" still />
          </MercbotSidebarRow>
        </li>
      </ul>
    </section>

    <MercbotContextMenu v-model="menu.open" :target="menu.target" :items="menu.items" />
    <MercbotConfirmDialog
      :model-value="Boolean(asking)"
      :title="question()?.title || ''"
      :text="question()?.text || ''"
      :confirm-label="question()?.confirmLabel"
      :danger="Boolean(question()?.danger)"
      @update:model-value="!$event && (asking = null)"
      @confirm="confirmAsked"
    />
  </div>
</template>

<style scoped src="./MercbotChatList.css"></style>

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
  background: rgb(var(--v-theme-surface-container-highest));
  font-weight: 600;
}
</style>
