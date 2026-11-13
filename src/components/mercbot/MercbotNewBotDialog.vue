<script setup>
import { computed, nextTick, ref, watch } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import { BOT_COLOURS, BOT_PALETTE } from "@/theme/palettes.js";
import { isBlack } from "./accent.js";
import { SHAPES, SPECIAL_SHAPE } from "./avatarShapes.js";

// New bot dialog. The shell does the creating; this collects name, shape and colour.
const props = defineProps({
  busy: { type: Boolean, default: false },
  error: { type: String, default: "" },
  // A name to start with, as from the group picker's "create a new bot" offer.
  initialName: { type: String, default: "" },
  // The home's bots, so a new one starts in a colour and cloud nobody has yet (D-44).
  bots: { type: Array, default: () => [] }
});
const open = defineModel({ type: Boolean, default: false });
const emit = defineEmits(["create"]);

const name = ref("");
const shape = ref(SHAPES[0].id);
const color = ref(BOT_PALETTE[0].color);
const nameInput = ref(null);
const special = computed(() => shape.value === SPECIAL_SHAPE.id);
const shownColor = computed(() => (special.value ? SPECIAL_SHAPE.color : color.value));
const canCreate = computed(() => Boolean(name.value.trim()) && !props.busy);
const preview = computed(() => ({ id: "new", name: name.value || "New bot", shape: shape.value, color: shownColor.value }));
const pick = (list) => list[Math.floor(Math.random() * list.length)];
// A random choice, from those not taken yet while any are left.
function pickFresh(list, taken) {
  const fresh = list.filter((entry) => !taken.has(entry));
  return pick(fresh.length ? fresh : list);
}
// Every cloud, Mercbot's own last, ten to a row (D-44).
const rows = Array.from({ length: Math.ceil((SHAPES.length + 1) / 10) }, (_, index) => [...SHAPES, SPECIAL_SHAPE].slice(index * 10, index * 10 + 10));
const colourRows = [BOT_PALETTE.slice(0, 6), BOT_PALETTE.slice(6)];

// Each opening starts empty, with a random shape and colour, preferring ones no bot in the home has.
watch(open, (value) => {
  if (!value) return;
  const bots = props.bots.filter((bot) => bot.kind !== "group");
  name.value = props.initialName;
  shape.value = pickFresh(SHAPES.map((entry) => entry.id), new Set(bots.map((bot) => bot.shape)));
  color.value = pickFresh(BOT_PALETTE.map((entry) => entry.color), new Set(bots.map((bot) => (isBlack(bot.color) ? BOT_COLOURS.Black : String(bot.color).toUpperCase()))));
  nextTick(() => nameInput.value?.focus());
});

function pickColour(value) {
  color.value = value;
  if (special.value) shape.value = SHAPES[0].id;
}

function create() {
  if (!canCreate.value) return;
  emit("create", { name: name.value.trim(), shape: shape.value, color: shownColor.value });
}

function close() {
  if (!props.busy) open.value = false;
}
</script>

<template>
  <v-dialog :model-value="open" width="440" :persistent="busy" @update:model-value="close">
    <div class="mb-newbot" role="dialog" aria-labelledby="mb-newbot-title">
      <div class="mb-newbot__head">
        <h2 id="mb-newbot-title" class="mb-newbot__title">New bot</h2>
        <button type="button" class="mb-newbot__close" aria-label="Close" :disabled="busy" @click="close">
          <v-icon icon="$close" size="14" />
        </button>
      </div>

      <div class="mb-newbot__preview"><MercbotAvatar :bot="preview" :size="100" /></div>

      <input
        ref="nameInput"
        v-model="name"
        class="mb-newbot__name"
        aria-label="Bot name"
        placeholder="What should your bot be called?"
        maxlength="80"
        :disabled="busy"
        @keydown.enter.prevent="create"
      >

      <div class="mb-newbot__shapes" role="radiogroup" aria-label="Shape">
        <div v-for="(row, rowIndex) in rows" :key="rowIndex" class="mb-newbot__row mb-newbot__row--shapes">
          <button
            v-for="entry in row"
            :key="entry.id"
            type="button"
            role="radio"
            class="mb-newbot__shape"
            :class="{ 'mb-newbot__shape--selected': shape === entry.id }"
            :aria-checked="shape === entry.id"
            :aria-label="entry.label"
            :disabled="busy"
            @click="shape = entry.id"
          >
            <MercbotAvatar :bot="{ id: `shape-${entry.id}`, name: entry.label, shape: entry.id, color: shownColor }" :size="32" still />
          </button>
        </div>
      </div>

      <div class="mb-newbot__colours" role="radiogroup" aria-label="Colour">
        <div v-for="(row, rowIndex) in colourRows" :key="rowIndex" class="mb-newbot__row mb-newbot__row--colours">
          <button
            v-for="entry in row"
            :key="entry.color"
            type="button"
            role="radio"
            class="mb-newbot__colour"
            :class="{ 'mb-newbot__colour--selected': !special && color === entry.color }"
            :style="{ background: entry.color }"
            :aria-checked="!special && color === entry.color"
            :aria-label="entry.name"
            :disabled="busy"
            @click="pickColour(entry.color)"
          />
        </div>
      </div>

      <p v-if="error" class="mb-newbot__error" role="alert">{{ error }}</p>

      <div class="mb-newbot__foot">
        <button type="button" class="mb-newbot__button" :disabled="busy" @click="close">Cancel</button>
        <button type="button" class="mb-newbot__button mb-newbot__button--primary" :disabled="!canCreate" @click="create">
          {{ busy ? "Creating…" : "Create" }}
        </button>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
.mb-newbot {
  display: flex;
  flex-direction: column;
  height: 580px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-newbot__head {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: space-between;
  height: 55px;
  padding: 0 14px 0 17px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
}

.mb-newbot__title {
  margin: 0;
  font-size: 15px;
  font-weight: 700;
}

.mb-newbot__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-newbot__preview {
  display: flex;
  justify-content: center;
  margin-top: 17px;
  line-height: 0;
}

.mb-newbot__name {
  align-self: center;
  width: 405px;
  height: 36px;
  margin-top: 11px;
  padding: 0 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 10px;
  background: rgb(var(--v-theme-surface));
  font: inherit;
  font-size: 14px;
  color: inherit;
  text-align: center;
  outline: none;
}

.mb-newbot__name:focus {
  border-color: rgb(var(--v-theme-outline));
}

.mb-newbot__name::placeholder {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-newbot__shapes {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-top: 27px;
}

.mb-newbot__row {
  display: flex;
  justify-content: center;
  gap: 20px;
}

/* The clouds sit ten to a row (D-44). */
.mb-newbot__row--shapes {
  gap: 10px;
}

.mb-newbot__shape {
  display: inline-flex;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  line-height: 0;
}

.mb-newbot__shape:hover,
.mb-newbot__shape--selected,
.mb-newbot__colour:hover,
.mb-newbot__colour--selected {
  box-shadow: 0 0 0 4px rgb(var(--v-theme-surface)), 0 0 0 5px rgb(var(--v-theme-outline));
}

.mb-newbot__shape:focus-visible,
.mb-newbot__colour:focus-visible,
.mb-newbot__button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 6px;
}

.mb-newbot__colours {
  display: flex;
  flex-direction: column;
  gap: 18px;
  margin-top: 44px;
}

.mb-newbot__row--colours {
  gap: 18px;
}

.mb-newbot__colour {
  width: 22px;
  height: 22px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  cursor: pointer;
}

.mb-newbot__error {
  margin: auto 16px 8px;
  font-size: 12px;
  color: rgb(var(--v-theme-error));
  text-align: right;
}

.mb-newbot__foot {
  display: flex;
  flex: none;
  justify-content: flex-end;
  gap: 8px;
  margin-top: auto;
  padding: 12px 13px;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
}

.mb-newbot__button {
  height: 30px;
  padding: 0 14px;
  border: 0;
  border-radius: 15px;
  background: rgb(var(--v-theme-surface-container-high));
  font: inherit;
  font-size: 13px;
  color: inherit;
  cursor: pointer;
}

.mb-newbot__button--primary {
  background: rgb(var(--v-theme-inverse-surface));
  color: rgb(var(--v-theme-inverse-on-surface));
}

.mb-newbot__button:disabled {
  cursor: default;
}

.mb-newbot__button--primary:disabled {
  background: rgba(var(--v-theme-on-surface), 0.12);
  color: rgba(var(--v-theme-on-surface), 0.38);
}

.mb-newbot__button:not(.mb-newbot__button--primary):disabled {
  opacity: 0.6;
}
</style>
