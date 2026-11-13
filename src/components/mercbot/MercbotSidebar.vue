<script setup>
import { computed, ref } from "vue";
import MercbotAccountMenu from "./MercbotAccountMenu.vue";
import MercbotConvoAvatar from "./MercbotConvoAvatar.vue";
import MercbotBotList from "./MercbotBotList.vue";
import { buildRailModel } from "./botDirectory.js";
import MercbotHomeSwitcher from "./MercbotHomeSwitcher.vue";
import MercbotAppsEntry from "../apps/MercbotAppsEntry.vue";
import MercbotFilesEntry from "../files/MercbotFilesEntry.vue";
import MercbotIconButton from "./MercbotIconButton.vue";
import MercbotTooltip from "./MercbotTooltip.vue";
import { emitResizeDrag } from "./pointerDrag.js";

// Sidebar shell: expanded or the compact rail; the bot list itself is MercbotBotList.
const props = defineProps({
  model: { type: Object, required: true },
  sections: { type: Array, required: true },
  currentBotId: { type: String, required: true },
  compact: { type: Boolean, default: false },
  width: { type: Number, required: true },
  hints: { type: Object, default: () => ({}) },
  switchHighlightId: { type: String, default: "" },
  drafts: { type: Object, default: () => ({}) },
  moods: { type: Object, default: () => ({}) },
  hiddenExpanded: { type: Boolean, default: false },
  editingSectionId: { type: String, default: "" },
  displayName: { type: String, required: true },
  initials: { type: String, required: true },
  // The person's own picture, shown on the account button in place of their initials ("" when they have none).
  picture: { type: String, default: "" }
});
const emit = defineEmits(["select", "command", "search", "new-bot", "connect-apps", "resize"]);
const rail = computed(() => buildRailModel(props.model));

// The footer: at rest the account's name and a square Connect apps button; while
// the footer is hovered, or the button has focus, the avatar and a wide pill with app icons.
const footerHovered = ref(false);
const appsFocused = ref(false);
const appsWide = computed(() => footerHovered.value || appsFocused.value);
const appIcons = ["$calendarToday", "$mail", "$description"];

</script>

<template>
  <nav class="mb-sidebar" :class="{ 'mb-sidebar--rail': compact }" :style="{ width: `${width}px` }" aria-label="Bots">
    <div v-if="!compact" class="mb-sidebar__actions">
      <div class="mb-sidebar__home"><MercbotHomeSwitcher /></div>
      <MercbotIconButton icon="$search" label="Search" @click="emit('search')" />
      <MercbotIconButton icon="$editSquare" label="New bot" @click="emit('new-bot')" />
    </div>
    <div v-else class="mb-sidebar__rail-top">
      <MercbotHomeSwitcher rail />
    </div>

    <MercbotFilesEntry :rail="compact" />
    <MercbotAppsEntry :rail="compact" />

    <div class="mb-sidebar__bots">
      <MercbotBotList
        v-if="!compact"
        :model="model"
        :sections="sections"
        :current-bot-id="currentBotId"
        :hints="hints"
        :switch-highlight-id="switchHighlightId"
        :drafts="drafts"
        :moods="moods"
        :hidden-expanded="hiddenExpanded"
        :editing-section-id="editingSectionId"
        @select="emit('select', $event)"
        @command="emit('command', $event)"
      />
      <ul v-else class="mb-rail-list">
        <template v-for="(group, groupIndex) in rail" :key="groupIndex">
          <li v-if="groupIndex > 0" class="mb-rail-list__divider" aria-hidden="true" />
          <li v-for="bot in group" :key="bot.id">
            <button
              type="button"
              class="mb-bot"
              :class="{ 'mb-bot--selected': bot.id === currentBotId, 'mb-bot--switching': bot.id === switchHighlightId }"
              :aria-current="bot.id === currentBotId ? 'page' : undefined"
              :aria-label="bot.name"
              @click="emit('select', bot.id)"
            >
              <MercbotConvoAvatar :bot="bot" :size="36" :state="moods[bot.id] || 'idle'" />
              <span v-if="bot.unread" class="mb-bot__unread" aria-label="Unread" />
              <kbd v-if="hints[bot.id]" class="mb-bot__hint">{{ hints[bot.id] }}</kbd>
            </button>
          </li>
        </template>
      </ul>
    </div>

    <div v-if="!compact" class="mb-sidebar__bottom" @mouseenter="footerHovered = true" @mouseleave="footerHovered = false">
      <MercbotAccountMenu
        :display-name="displayName"
        :initials="initials"
        :picture="picture"
        :collapsed="appsWide"
        @shortcuts="emit('command', { name: 'openShortcuts' })"
        @about="emit('command', { name: 'openAbout' })"
        @settings="emit('command', { name: 'openSettings' })"
        @usage="emit('command', { name: 'openUsage' })"
      />
      <MercbotTooltip text="Connect apps">
        <template #default="{ props: tooltipProps }">
          <button
            v-bind="tooltipProps"
            type="button"
            class="mb-apps"
            :class="{ 'mb-apps--square': !appsWide }"
            aria-label="Connect apps"
            @click="emit('connect-apps')"
            @focus="appsFocused = true"
            @blur="appsFocused = false"
          >
            <template v-if="appsWide">
              <span class="mb-apps__label">Connect apps</span>
              <span class="mb-apps__icons">
                <v-icon v-for="icon in appIcons" :key="icon" :icon="icon" size="12" />
              </span>
            </template>
            <v-icon v-else icon="$dashboardCustomize" size="16" />
          </button>
        </template>
      </MercbotTooltip>
    </div>

    <div v-else class="mb-sidebar__rail-bottom">
      <MercbotIconButton
        icon="$add"
        label="New bot"
        tone="bare"
        size="small"
        :icon-size="14"
        @click="emit('new-bot')"
      />
      <MercbotIconButton
        icon="$dashboardCustomize"
        label="Connect apps"
        tone="bare"
        size="small"
        @click="emit('connect-apps')"
      />
      <MercbotAccountMenu
        :display-name="displayName"
        :initials="initials"
        :picture="picture"
        :expandable="false"
        rail
        @shortcuts="emit('command', { name: 'openShortcuts' })"
        @about="emit('command', { name: 'openAbout' })"
        @settings="emit('command', { name: 'openSettings' })"
        @usage="emit('command', { name: 'openUsage' })"
      />
    </div>

    <div
      v-if="!compact"
      class="mb-sidebar__resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize sidebar"
      @pointerdown.prevent="emitResizeDrag($event, emit)"
    />
  </nav>
</template>

<style scoped>
.mb-sidebar {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  height: 100%;
  border-right: 1px solid rgb(var(--v-theme-outline-variant));
  background: rgb(var(--v-theme-surface-container-low));
}

.mb-sidebar__actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  padding: 12px 16px 0 10px;
}

/* The home switcher takes the room left of Search and New bot (D-36). */
.mb-sidebar__home {
  display: flex;
  flex: 0 1 auto;
  min-width: 0;
  margin-right: auto;
}

.mb-sidebar__rail-top {
  position: absolute;
  top: 12px;
  left: 0;
  right: 0;
  display: flex;
  justify-content: center;
  z-index: 1;
}

/* One scroll region between the top row and the account row, fading at its edges. */
.mb-sidebar__bots {
  flex: 1;
  overflow-y: auto;
  padding: 22px 0 24px;
  mask-image: linear-gradient(transparent, black 22px, black calc(100% - 24px), transparent);
}

.mb-sidebar--rail .mb-sidebar__bots {
  padding: 56px 16px 24px;
}

.mb-rail-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mb-rail-list__divider {
  height: 1px;
  margin: 4px 8px 8px;
  background: rgb(var(--v-theme-outline-variant));
}

.mb-bot {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 54px;
  height: 54px;
  margin-bottom: 4px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: transparent;
  font: inherit;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}

.mb-bot--switching {
  outline: 2px solid rgb(var(--v-theme-on-surface));
  outline-offset: -2px;
}

.mb-bot__unread {
  position: absolute;
  right: 8px;
  bottom: 8px;
  width: 10px;
  height: 10px;
  border: 2px solid rgb(var(--v-theme-surface-container-low));
  border-radius: 50%;
  background: rgb(var(--v-theme-link));
}

.mb-bot:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-bot--selected,
.mb-bot--selected:hover {
  background: rgb(var(--v-theme-secondary-container));
}

.mb-bot:focus-visible,
.mb-apps:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}

.mb-bot__hint {
  position: absolute;
  top: 2px;
  right: 2px;
  min-width: 16px;
  padding: 0 4px;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface));
  box-shadow: 0 0 0 1px rgb(var(--v-theme-outline-variant));
  font: 600 10px/16px var(--v-font-body);
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-sidebar__bottom {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 16px 16px;
}

.mb-apps {
  display: flex;
  flex: 1;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-width: 0;
  height: 34px;
  padding: 0 12px;
  font: inherit;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 17px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}

.mb-apps:hover {
  border-color: rgb(var(--v-theme-outline-variant));
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-apps--square {
  flex: none;
  width: 34px;
  margin-left: auto;
  padding: 0;
  border-radius: 9px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-apps__label {
  overflow: hidden;
  font-size: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-apps__icons {
  display: inline-flex;
  gap: 2px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-sidebar__rail-bottom {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding-bottom: 16px;
}

.mb-sidebar__rail-bottom > :last-child {
  margin-top: 6px;
}

.mb-sidebar__resize {
  position: absolute;
  top: 0;
  right: -4px;
  bottom: 0;
  z-index: 2;
  width: 7px;
  cursor: col-resize;
  touch-action: none;
}
</style>
