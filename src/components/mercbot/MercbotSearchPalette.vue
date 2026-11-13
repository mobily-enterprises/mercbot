<script setup>
import { computed, nextTick, ref, watch } from "vue";
import MercbotConvoAvatar from "./MercbotConvoAvatar.vue";
import MercbotPluginLogo from "./MercbotPluginLogo.vue";
import { botsApi } from "./botsApi.js";
import { paletteCommands, paletteEntries } from "./paletteEntries.js";
import { pluginsApi } from "./pluginsApi.js";
import { useShellInitials } from "./shellInitials.js";

// The search palette: bots and groups, then commands, before you type
// (hidden bots left out); while typing, bots and groups, apps, hidden bots, commands, routines
// and messages, matched loosely (letters in order), the earliest first letter ranking first,
// with contiguous runs in bold. No motion, nothing remembered between openings.
const props = defineProps({
  bots: { type: Array, required: true },
  currentBot: { type: Object, default: null },
  settingsSections: { type: Array, default: () => [] },
  theme: { type: String, default: "system" }
});
const open = defineModel({ type: Boolean, default: false });
const emit = defineEmits(["run"]);
const initials = useShellInitials();

const query = ref("");
const active = ref(0);
const input = ref(null);
const list = ref(null);
const apps = ref([]);
const routines = ref([]);
const messages = ref([]);
// Files, charts and pages bots made, found by name before messages.
const files = ref([]);
const searching = ref(false);

watch(open, async (value) => {
  if (!value) return;
  query.value = "";
  active.value = 0;
  messages.value = [];
  await nextTick();
  input.value?.focus();
  if (list.value) list.value.scrollTop = 0;
  pluginsApi.list().then((result) => { apps.value = result.plugins; }).catch(() => { apps.value = []; });
  botsApi.search("").then((result) => { routines.value = result.routines; }).catch(() => { routines.value = []; });
});

// Message text is searched on the server, a moment after typing stops.
let messageTimer = null;
watch(query, (text) => {
  active.value = 0;
  clearTimeout(messageTimer);
  messages.value = [];
  files.value = [];
  if (text.trim().length < 2) {
    searching.value = false;
    return;
  }
  searching.value = true;
  messageTimer = setTimeout(async () => {
    let found = { messages: [], files: [] };
    try {
      found = await botsApi.search(text.trim());
    } catch {
      found = { messages: [], files: [] };
    }
    if (query.value !== text) return;
    messages.value = found.messages || [];
    files.value = found.files || [];
    searching.value = false;
  }, 150);
});

const COMMANDS = computed(() => paletteCommands({ currentBot: props.currentBot, settingsSections: props.settingsSections, theme: props.theme }));

const entries = computed(() => paletteEntries({
  needle: query.value.trim().toLowerCase(),
  bots: props.bots,
  commands: COMMANDS.value,
  apps: apps.value,
  routines: routines.value,
  files: files.value,
  messages: messages.value
}));

// While messages are being searched and nothing else matches, five placeholder rows show.
const loading = computed(() => searching.value && !entries.value.length);

function messageAvatar(message) {
  const conversation = props.bots.find((bot) => bot.id === message.conversationId);
  if (conversation?.kind === "group") return conversation;
  if (message.role === "bot") return conversation || null;
  return null;
}

// The contiguous match in a title, for bold.
function parts(text) {
  const needle = query.value.trim().toLowerCase();
  const value = String(text || "");
  const at = needle ? value.toLowerCase().indexOf(needle) : -1;
  if (at === -1) return [{ text: value }];
  return [
    { text: value.slice(0, at) },
    { text: value.slice(at, at + needle.length), bold: true },
    { text: value.slice(at + needle.length) }
  ];
}

function move(step) {
  const last = entries.value.length - 1;
  active.value = Math.max(0, Math.min(last, active.value + step));
  nextTick(() => list.value?.querySelector(".mb-palette__row--active")?.scrollIntoView({ block: "nearest" }));
}

function choose(entry) {
  if (!entry) return;
  open.value = false;
  emit("run", entry);
}

function onKeydown(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    move(event.key === "ArrowDown" ? 1 : -1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    choose(entries.value[active.value]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    open.value = false;
  } else if (event.key === "Tab") {
    event.preventDefault();
  }
}
</script>

<template>
  <div v-if="open" class="mb-palette-scrim" @mousedown.self="open = false">
    <div class="mb-palette" role="dialog" aria-label="Search">
      <div class="mb-palette__field">
        <v-icon icon="$search" size="14" />
        <input
          ref="input"
          v-model="query"
          class="mb-palette__input"
          aria-label="Search"
          placeholder="Search"
          @keydown="onKeydown"
        >
      </div>
      <ul ref="list" class="mb-palette__list" role="listbox" aria-label="Results">
        <li
          v-for="(entry, index) in entries"
          :key="entry.key"
          role="option"
          class="mb-palette__row"
          :class="{ 'mb-palette__row--active': index === active }"
          :aria-selected="index === active"
          @mousemove="active = index"
          @click="choose(entry)"
        >
          <span class="mb-palette__lead">
            <MercbotConvoAvatar v-if="entry.kind === 'conversation'" :bot="entry.bot" :size="20" still />
            <MercbotPluginLogo v-else-if="entry.kind === 'app'" :plugin="entry.plugin" :size="20" />
            <span v-else-if="entry.kind === 'routine'" class="mb-palette__clock"><v-icon icon="$schedule" size="12" /></span>
            <template v-else-if="entry.kind === 'message'">
              <MercbotConvoAvatar v-if="messageAvatar(entry.message)" :bot="messageAvatar(entry.message)" :size="20" still />
              <span v-else class="mb-palette__person">{{ initials }}</span>
            </template>
            <span v-else class="mb-palette__icon"><v-icon :icon="entry.icon" size="13" /></span>
          </span>
          <span class="mb-palette__text">
            <span class="mb-palette__title">
              <span class="mb-palette__title-text">
                <template v-for="(part, partIndex) in parts(entry.title)" :key="partIndex">
                  <b v-if="part.bold">{{ part.text }}</b><template v-else>{{ part.text }}</template>
                </template>
              </span>
              <span v-if="entry.chip" class="mb-palette__chip">{{ entry.chip }}</span>
            </span>
            <span v-if="entry.secondary || entry.category" class="mb-palette__secondary">{{ entry.secondary || entry.category }}</span>
          </span>
          <span v-if="entry.tag" class="mb-palette__tag">{{ entry.tag }}</span>
          <span v-if="entry.unread" class="mb-palette__unread" aria-label="Unread" />
          <v-icon v-if="entry.checked" icon="$check" size="16" class="mb-palette__tick" />
        </li>
        <template v-if="loading">
          <li v-for="index in 5" :key="`skeleton-${index}`" class="mb-palette__row mb-palette__skeleton" aria-hidden="true">
            <span class="mb-palette__skeleton-icon" />
            <span class="mb-palette__text">
              <span class="mb-palette__skeleton-bar" :style="{ width: `${[46, 62, 38, 55, 42][index - 1]}%`, height: '12px' }" />
              <span class="mb-palette__skeleton-bar" :style="{ width: `${[28, 34, 24, 30, 22][index - 1]}%`, height: '8px' }" />
            </span>
          </li>
        </template>
        <li v-else-if="!entries.length" class="mb-palette__empty">No results</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.mb-palette-scrim {
  position: fixed;
  inset: 0;
  z-index: 2600;
  background: rgba(var(--v-theme-scrim), 0.5);
}

.mb-palette {
  position: absolute;
  top: 20%;
  left: 50%;
  display: flex;
  flex-direction: column;
  width: min(560px, calc(100vw - 32px));
  height: min(453px, calc(80vh - 16px));
  overflow: hidden;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  transform: translateX(-50%);
}

.mb-palette__field {
  display: flex;
  flex: none;
  align-items: center;
  gap: 6px;
  height: 48px;
  padding: 0 17px;
  border-bottom: 1px solid rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-palette__input {
  flex: 1;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface));
  outline: none;
}

.mb-palette__input::placeholder {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-palette__list {
  flex: 1;
  margin: 0;
  padding: 8px 9px;
  overflow-y: auto;
  list-style: none;
  scrollbar-width: thin;
}

.mb-palette__row {
  display: flex;
  align-items: center;
  gap: 12px;
  height: 45px;
  margin-bottom: 6px;
  padding: 0 8px;
  border-radius: 10px;
  cursor: pointer;
}

.mb-palette__row--active {
  background: rgb(var(--v-theme-surface-container-highest));
}

.mb-palette__lead {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.mb-palette__icon,
.mb-palette__clock,
.mb-palette__person {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-palette__clock {
  border-radius: 50%;
  background: rgba(var(--v-theme-link), 0.12);
  color: rgb(var(--v-theme-link));
}

.mb-palette__person {
  border-radius: 50%;
  font-size: 8px;
  font-weight: 700;
}

.mb-palette__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.mb-palette__title {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
  font-size: 13px;
  line-height: 18px;
}

.mb-palette__title-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-palette__title b {
  font-weight: 700;
}

.mb-palette__chip {
  flex: none;
  padding: 0 6px;
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 11px;
  line-height: 16px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-palette__secondary {
  overflow: hidden;
  font-size: 12px;
  line-height: 16px;
  color: rgb(var(--v-theme-on-surface-variant));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.v-theme--dark .mb-palette__secondary {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-palette__tag {
  flex: none;
  padding: 0 6px;
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 11px;
  line-height: 16px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-palette__skeleton {
  cursor: default;
}

.mb-palette__skeleton-icon {
  flex: none;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-palette__skeleton .mb-palette__text {
  gap: 6px;
}

.mb-palette__skeleton-bar {
  display: block;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-palette__unread {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: rgb(var(--v-theme-link));
}

.mb-palette__tick {
  flex: none;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-palette__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
