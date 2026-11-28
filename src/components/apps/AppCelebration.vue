<script setup>
// A celebration (D-143): a button's `celebrate` step, its words over the app's area, read out to screen readers, with
// confetti in the theme's colours falling past them. It never takes a click, and it lets motion be: with reduced motion
// the confetti stays away and the words just show. The frame takes it away once it has played.
defineProps({
  message: { type: String, required: true }
});

const PIECES = 24;
// The theme's brightest roles, whatever its seed.
const TONES = ["primary", "success", "warning", "info", "error"];
// Spread across the area and a little apart in time, the same every time, so nothing depends on chance.
const pieces = Array.from({ length: PIECES }, (_, index) => ({
  tone: TONES[index % TONES.length],
  style: {
    left: `${(index * 37 + 11) % 100}%`,
    animationDelay: `${(index % 6) * 80}ms`,
    animationDuration: `${1400 + (index % 4) * 220}ms`,
    transform: `rotate(${(index * 47) % 360}deg)`
  }
}));
</script>

<template>
  <div class="app-celebration" role="status" aria-live="polite">
    <div class="app-confetti" aria-hidden="true">
      <span v-for="(piece, index) in pieces" :key="index" :class="`app-confetti__piece app-confetti__piece--${piece.tone}`" :style="piece.style" />
    </div>
    <div class="app-celebration__words text-headline-small elevation-3">{{ message }}</div>
  </div>
</template>

<style scoped>
.app-celebration {
  position: absolute;
  inset: 0;
  z-index: 5;
  overflow: hidden;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}
.app-celebration__words {
  max-width: min(90%, 520px);
  padding: 16px 28px;
  border-radius: 28px;
  text-align: center;
  font-weight: 700;
  background: rgb(var(--v-theme-surface-container-highest));
  color: rgb(var(--v-theme-on-surface));
  animation: app-celebration-pop 420ms cubic-bezier(0.2, 0.9, 0.3, 1.3) both;
}
.app-confetti {
  position: absolute;
  inset: 0;
}
.app-confetti__piece {
  position: absolute;
  top: -16px;
  width: 10px;
  height: 14px;
  border-radius: 3px;
  animation-name: app-confetti-fall;
  animation-timing-function: cubic-bezier(0.3, 0.6, 0.6, 1);
  animation-fill-mode: both;
}
.app-confetti__piece--primary {
  background: rgb(var(--v-theme-primary));
}
.app-confetti__piece--success {
  background: rgb(var(--v-theme-success));
}
.app-confetti__piece--warning {
  background: rgb(var(--v-theme-warning));
}
.app-confetti__piece--info {
  background: rgb(var(--v-theme-info));
}
.app-confetti__piece--error {
  background: rgb(var(--v-theme-error));
}
@keyframes app-confetti-fall {
  from {
    translate: 0 0;
    rotate: 0deg;
    opacity: 1;
  }
  to {
    translate: 0 110vh;
    rotate: 540deg;
    opacity: 0.6;
  }
}
@keyframes app-celebration-pop {
  from {
    scale: 0.6;
    opacity: 0;
  }
  to {
    scale: 1;
    opacity: 1;
  }
}
@media (prefers-reduced-motion: reduce) {
  .app-confetti {
    display: none;
  }
  .app-celebration__words {
    animation: none;
  }
}
</style>
