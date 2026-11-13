<script setup>
import { onBeforeUnmount, ref, watch } from "vue";

// A right-click menu at the pointer. Items: { title, icon, run, danger,
// disabled }, { divider: true }, or { title, icon, submenu: [items with optional checked] }. A bot's
// message adds a row of reactions above them, the chosen one marked; picking one emits `react`.
// It takes the keyboard as it opens, so the arrows reach its rows (the Library's "…" opens it too),
// and as it closes it gives focus back to what had it, unless that moved elsewhere meanwhile.
const open = defineModel({ type: Boolean, default: false });
defineProps({
  target: { type: Array, default: () => [0, 0] },
  items: { type: Array, default: () => [] },
  reactions: { type: Array, default: () => [] },
  chosenReaction: { type: String, default: null }
});
const emit = defineEmits(["react"]);
const list = ref(null);
let opener = null;
let heldArrow = null;

const content = () => list.value?.$el.closest(".v-overlay__content");

// The menu can take focus only once it shows: its opening transition keeps it hidden until it's placed, a frame or
// two after it opens, longer on a busy machine. An arrow pressed before then (Enter then ArrowDown, typed quickly)
// would reach what still has focus, "…" or the page, and be lost. It is held instead, and given to the menu as it
// takes focus, so it moves to the first row (or, for ArrowUp, the last) as if pressed then.
function holdArrow(event) {
  if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
  event.preventDefault();
  event.stopImmediatePropagation();
  heldArrow = event.key;
}

function giveHeldArrow(event) {
  if (!content()?.contains(event.target)) return;
  stopHolding();
  if (heldArrow) event.target.dispatchEvent(new KeyboardEvent("keydown", { key: heldArrow, bubbles: true, cancelable: true }));
  heldArrow = null;
}

function stopHolding() {
  document.removeEventListener("keydown", holdArrow, true);
  document.removeEventListener("focusin", giveHeldArrow, true);
}

watch(open, (isOpen) => {
  if (isOpen) {
    opener = document.activeElement;
    document.addEventListener("keydown", holdArrow, true);
    document.addEventListener("focusin", giveHeldArrow, true);
    return;
  }
  stopHolding();
  heldArrow = null;
  if (opener?.isConnected && content()?.contains(document.activeElement)) opener.focus();
  opener = null;
});

onBeforeUnmount(stopHolding);

function runItem(item) {
  open.value = false;
  item.run();
}

function react(emoji) {
  open.value = false;
  emit("react", emoji);
}
</script>

<template>
  <v-menu v-model="open" :target="target" context-menu location="bottom start" content-class="mb-popover">
    <v-list ref="list" density="compact" class="mb-menu py-1" width="228">
      <template v-if="reactions.length">
        <div class="mb-menu__reactions" role="group" aria-label="Reactions">
          <button
            v-for="emoji in reactions"
            :key="emoji"
            type="button"
            class="mb-menu__reaction"
            :class="{ 'mb-menu__reaction--chosen': chosenReaction === emoji }"
            :aria-label="`React with ${emoji}`"
            :aria-pressed="chosenReaction === emoji"
            @click="react(emoji)"
          >
            {{ emoji }}
          </button>
        </div>
        <v-divider class="my-1" />
      </template>
      <template v-for="(item, index) in items" :key="index">
        <v-divider v-if="item.divider" class="my-1" />
        <v-menu v-else-if="item.submenu" open-on-hover location="end" :offset="4" content-class="mb-popover">
          <template #activator="{ props: submenuProps }">
            <v-list-item v-bind="submenuProps" min-height="32" class="px-3">
              <template #prepend><v-icon :icon="item.icon" size="14" /></template>
              <span class="mb-menu__text">{{ item.title }}</span>
              <template #append><v-icon icon="$chevronRight" size="14" /></template>
            </v-list-item>
          </template>
          <v-list density="compact" class="mb-menu py-1" width="200" max-height="320" style="overflow-y: auto">
            <template v-for="(sub, subIndex) in item.submenu" :key="subIndex">
              <v-divider v-if="sub.divider" class="my-1" />
              <v-list-item v-else min-height="32" class="px-3" :disabled="sub.disabled" @click="runItem(sub)">
                <template #prepend><v-icon :icon="sub.checked ? '$check' : sub.icon || '$check'" size="14" :style="{ opacity: sub.checked || sub.icon ? 1 : 0 }" /></template>
                <span class="mb-menu__text">{{ sub.title }}</span>
              </v-list-item>
            </template>
          </v-list>
        </v-menu>
        <v-list-item
          v-else
          min-height="32"
          class="px-3"
          :class="{ 'mb-menu__danger': item.danger }"
          :disabled="item.disabled"
          @click="runItem(item)"
        >
          <template #prepend><v-icon :icon="item.icon" size="14" /></template>
          <span class="mb-menu__text">{{ item.title }}</span>
        </v-list-item>
      </template>
    </v-list>
  </v-menu>
</template>

<style>
.mb-menu__text {
  font-size: 13px;
  white-space: nowrap;
}

.mb-menu__danger {
  color: rgb(var(--v-theme-error));
}

.mb-menu__reactions {
  display: flex;
  justify-content: space-between;
  padding: 2px 8px;
}

.mb-menu__reaction {
  width: 32px;
  height: 32px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  font-size: 18px;
  line-height: 32px;
  cursor: pointer;
}

.mb-menu__reaction:hover,
.mb-menu__reaction--chosen {
  background: rgb(var(--v-theme-surface-container-high));
}
</style>
