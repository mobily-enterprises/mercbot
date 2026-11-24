<script setup>
// On a phone the chat list is a drawer over the chat (useShellLayout): it slides in from the left over a dimmed
// backdrop, and closes with a tap on the backdrop or a swipe back toward the edge, following the finger as it goes.
// Only its transform and the backdrop's opacity move, so it stays cheap on any phone; with reduced motion it just
// appears and goes. Elsewhere the list stays in its place, as the slot alone.
import { ref } from "vue";
import { SWIPE_START_PX, swipeCloses } from "./drawerSwipe.js";

defineProps({
  phone: { type: Boolean, required: true }
});
const open = defineModel("open", { type: Boolean, required: true });
const panel = ref(null);
// How far the finger has pulled the drawer toward its edge, in pixels (0 or less).
const dragged = ref(0);
const dragging = ref(false);
// The touch under way, if any: where and when it started.
let touch = null;

// Touch events, not pointer events: the browser cancels a pointer the moment the list under the finger would scroll,
// while a touch's moves keep arriving.
function start(event) {
  const [finger] = event.changedTouches;
  if (event.touches.length !== 1 || !finger) return;
  touch = { id: finger.identifier, x: finger.clientX, y: finger.clientY, at: event.timeStamp };
}

/** The touch under way's own finger, among those `event` changed. */
const fingerOf = (event) => [...event.changedTouches].find((finger) => finger.identifier === touch?.id);

function move(event) {
  const finger = fingerOf(event);
  if (!finger) return;
  const dx = finger.clientX - touch.x;
  const dy = finger.clientY - touch.y;
  if (!dragging.value) {
    if (Math.hypot(dx, dy) < SWIPE_START_PX) return;
    // Up or down scrolls the list, and a move away from the edge isn't a close: the touch is left to the page.
    if (dx >= 0 || Math.abs(dy) > Math.abs(dx)) {
      touch = null;
      return;
    }
    dragging.value = true;
  }
  dragged.value = Math.min(0, dx);
}

function release(event, { cancelled = false } = {}) {
  if (!fingerOf(event)) return;
  const closes = !cancelled && dragging.value && swipeCloses({ dragged: dragged.value, width: panel.value?.offsetWidth || 0, ms: event.timeStamp - touch.at });
  touch = null;
  dragging.value = false;
  // A swipe that closes slides the drawer out from where the finger left it (afterLeave puts it back); anything else
  // springs it back.
  if (closes) open.value = false;
  else dragged.value = 0;
}
</script>

<template>
  <template v-if="phone">
    <Transition name="mb-drawer-scrim">
      <div v-if="open" class="mb-drawer__scrim" @click="open = false" />
    </Transition>
    <Transition name="mb-drawer" @after-leave="dragged = 0">
      <div
        v-show="open"
        ref="panel"
        class="mb-drawer"
        :class="{ 'mb-drawer--dragging': dragging }"
        :style="{ '--mb-drawer-dragged': `${dragged}px` }"
        @touchstart.passive="start"
        @touchmove.passive="move"
        @touchend="release"
        @touchcancel="release($event, { cancelled: true })"
      >
        <slot />
      </div>
    </Transition>
  </template>
  <slot v-else />
</template>

<style scoped>
.mb-drawer {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  z-index: 21;
  box-shadow: var(--mb-shadow-popover);
  transform: translateX(var(--mb-drawer-dragged, 0px));
  /* As the app's other drawers (Vuetify's v-navigation-drawer) slide, in and out. */
  transition: transform 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

.mb-drawer--dragging {
  transition: none;
}

.mb-drawer-enter-from,
.mb-drawer-leave-to {
  transform: translateX(-100%);
}

.mb-drawer__scrim {
  position: absolute;
  inset: 0;
  z-index: 20;
  background: rgba(var(--v-theme-scrim), 0.18);
}

.mb-drawer-scrim-enter-active,
.mb-drawer-scrim-leave-active {
  transition: opacity 200ms cubic-bezier(0.4, 0, 0.2, 1);
}

.mb-drawer-scrim-enter-from,
.mb-drawer-scrim-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .mb-drawer,
  .mb-drawer-scrim-enter-active,
  .mb-drawer-scrim-leave-active {
    transition: none;
  }
}
</style>
