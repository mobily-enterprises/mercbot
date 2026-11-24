<script setup>
// An on/off switch for settings: blue when on, light grey when off.
defineProps({
  label: { type: String, required: true },
  disabled: { type: Boolean, default: false }
});
const model = defineModel({ type: Boolean, default: false });
</script>

<template>
  <button
    type="button"
    role="switch"
    class="mb-toggle"
    :class="{ 'mb-toggle--on': model }"
    :aria-checked="model"
    :aria-label="label"
    :disabled="disabled"
    @click="model = !model"
  >
    <span class="mb-toggle__knob" />
  </button>
</template>

<style scoped>
.mb-toggle {
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-container-highest));
  cursor: pointer;
  transition: background 0.15s ease;
}

.mb-toggle--on {
  background: rgb(var(--v-theme-link));
}

/* Keyboard focus: the ring Mercbot's other controls draw, in the scheme's secondary, which stands out at least 3:1 from
   what's behind it in light and dark (Material 3's focus indicator). The browser's own ring was all but invisible on
   dark surfaces. */
.mb-toggle:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}

.mb-toggle:disabled {
  opacity: 0.5;
  cursor: default;
}

.mb-toggle__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-lowest));
  box-shadow: 0 1px 2px rgba(var(--v-theme-shadow), 0.2);
  transition: transform 0.15s ease;
}

.mb-toggle--on .mb-toggle__knob {
  transform: translateX(16px);
}
</style>
