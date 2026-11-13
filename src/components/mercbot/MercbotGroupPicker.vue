<script setup>
import { computed, nextTick, onMounted, ref, watch } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";

// The recipient picker that starts a group chat: chosen bots as chips, a field that
// filters the rest, Enter to add, Backspace to take the last one off, Escape to close the list
// and then the picker. While typing, the first row offers a new bot with that name. Enter in an
// empty field with bots chosen starts the group with no message.
const props = defineProps({
  chosen: { type: Array, required: true },
  candidates: { type: Array, required: true }
});
const emit = defineEmits(["change", "close", "new-bot", "start"]);
const MAX_BOTS = 6;

const query = ref("");
const listOpen = ref(true);
const highlight = ref(0);
const field = ref(null);

const rows = computed(() => {
  const chosenIds = new Set(props.chosen.map((bot) => bot.id));
  const text = query.value.trim().toLowerCase();
  const bots = props.candidates
    .filter((bot) => !chosenIds.has(bot.id) && (!text || bot.name.toLowerCase().includes(text)))
    .map((bot) => ({ key: bot.id, bot }));
  return text ? [{ key: "new", create: query.value.trim() }, ...bots] : bots;
});
const full = computed(() => props.chosen.length >= MAX_BOTS);

watch(rows, () => {
  highlight.value = Math.min(highlight.value, Math.max(0, rows.value.length - 1));
});
// While typing, the first matching bot is highlighted; the create offer above it is reached with
// Up, or is the only row when nothing matches.
const firstBot = () => Math.max(0, rows.value.findIndex((row) => row.bot));
watch(query, () => {
  listOpen.value = true;
  highlight.value = firstBot();
});

function choose(row) {
  if (!row) return;
  if (row.create) {
    emit("new-bot", row.create);
  } else if (!full.value) {
    emit("change", [...props.chosen.map((bot) => bot.id), row.bot.id]);
  }
  query.value = "";
  nextTick(() => {
    highlight.value = 0;
    field.value?.focus();
  });
}

function removeChip(bot) {
  emit("change", props.chosen.filter((entry) => entry.id !== bot.id).map((entry) => entry.id));
  field.value?.focus();
}

function onKeydown(event) {
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    listOpen.value = true;
    const step = event.key === "ArrowDown" ? 1 : -1;
    highlight.value = (highlight.value + step + rows.value.length) % Math.max(1, rows.value.length);
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (!query.value.trim() && props.chosen.length) emit("start");
    else if (listOpen.value) choose(rows.value[highlight.value]);
  } else if (event.key === "Backspace" && !query.value && props.chosen.length) {
    removeChip(props.chosen[props.chosen.length - 1]);
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    if (listOpen.value) listOpen.value = false;
    else emit("close");
  }
}

onMounted(() => field.value?.focus());
defineExpose({ focus: () => field.value?.focus() });
</script>

<template>
  <div class="mb-picker">
    <div class="mb-picker__bar">
      <span class="mb-picker__label">To:</span>
      <span v-for="bot in chosen" :key="bot.id" class="mb-picker__chip">
        <MercbotAvatar :bot="bot" :size="14" still />
        <span class="mb-picker__chip-name">{{ bot.name }}</span>
        <button type="button" class="mb-picker__chip-remove" :aria-label="`Remove ${bot.name}`" @click="removeChip(bot)">
          <v-icon icon="$close" size="12" />
        </button>
      </span>
      <input
        ref="field"
        v-model="query"
        class="mb-picker__field"
        :placeholder="chosen.length ? '' : 'Who do you want to chat with?'"
        aria-label="Add bots to the group"
        @keydown="onKeydown"
        @focus="listOpen = true"
      >
      <button type="button" class="mb-picker__close" aria-label="Close" @click="emit('close')">
        <v-icon icon="$close" size="16" />
      </button>
    </div>
    <ul v-if="listOpen && rows.length" class="mb-picker__list" role="listbox" aria-label="Bots">
      <li
        v-for="(row, index) in rows"
        :key="row.key"
        class="mb-picker__row"
        :class="{ 'mb-picker__row--active': index === highlight }"
        role="option"
        :aria-selected="index === highlight"
        @mouseenter="highlight = index"
        @mousedown.prevent="choose(row)"
      >
        <template v-if="row.create">
          <span class="mb-picker__new"><v-icon icon="$add" size="12" /></span>
          <span class="mb-picker__row-name">{{ full ? "Add a new bot" : "Create a new bot" }} called “{{ row.create }}”</span>
        </template>
        <template v-else>
          <MercbotAvatar :bot="row.bot" :size="20" still />
          <span class="mb-picker__row-name">{{ row.bot.name }}</span>
          <span v-if="index === highlight" class="mb-picker__hint">Add to group</span>
        </template>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mb-picker {
  position: absolute;
  inset: 0 0 auto;
  z-index: 3;
}

.mb-picker__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-height: 48px;
  padding: 10px 44px 10px 12px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  background: rgb(var(--v-theme-background));
}

.mb-picker__label {
  margin-right: 2px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-picker__chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 28px;
  padding: 0 4px 0 8px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 13px;
}

.mb-picker__chip-remove,
.mb-picker__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-picker__chip-remove {
  width: 20px;
  height: 20px;
  border-radius: 10px;
}

.mb-picker__close {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  border-radius: 14px;
}

.mb-picker__chip-remove:hover,
.mb-picker__close:hover {
  background: rgb(var(--v-theme-surface-container-highest));
}

.mb-picker__field {
  flex: 1;
  min-width: 120px;
  height: 28px;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  outline: none;
}

.mb-picker__field::placeholder {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-picker__list {
  position: absolute;
  top: calc(100% + 1px);
  left: 33px;
  width: min(558px, calc(100% - 66px));
  max-height: 340px;
  margin: 0;
  padding: 6px;
  overflow-y: auto;
  list-style: none;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--mb-shadow-popover);
}

.mb-picker__row {
  display: flex;
  align-items: center;
  gap: 10px;
  height: 38px;
  padding: 0 10px;
  border-radius: 8px;
  font-size: 14px;
  cursor: pointer;
}

.mb-picker__row--active {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-picker__row-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-picker__hint {
  font-size: 11px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-picker__new {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
