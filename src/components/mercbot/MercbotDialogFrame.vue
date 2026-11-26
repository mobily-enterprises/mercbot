<script setup>
import { computed, ref, useId, watch } from "vue";
import { useDisplay } from "vuetify";

// JSKIT's Dialog role (shell-web's UI kit) in Mercbot's shared dialog frame (docs/ui-style.md, section 6, the `.mb-ctemp`
// CSS): a head with the title, which names the dialog, and its close (first on a phone, which it fills, last
// otherwise), the body, and a foot with the actions, the main one last. Escape, a click outside and the close ask the
// view to close it (`close`); the view decides, and gives focus back. The body and actions are made afresh each time it
// opens, so a field's autofocus takes the focus.
const props = defineProps({
  open: { type: Boolean, required: true },
  title: { type: String, required: true }
});
const emit = defineEmits(["close"]);
const display = useDisplay();
const phone = computed(() => display.width.value < 600);
const titleId = useId();
const shown = ref(props.open);
watch(() => props.open, (open) => {
  if (open) shown.value = true;
});
</script>

<template>
  <v-dialog
    :model-value="open"
    width="auto"
    :fullscreen="phone"
    @update:model-value="(value) => value || emit('close')"
    @after-leave="shown = false"
  >
    <div class="mb-ctemp mb-dialog-frame" :class="{ 'mb-ctemp--phone': phone }" role="dialog" :aria-labelledby="titleId">
      <div class="mb-ctemp__head">
        <button v-if="phone" type="button" class="mb-ctemp__close" aria-label="Close" @click="emit('close')">
          <v-icon icon="$close" size="18" />
        </button>
        <h2 :id="titleId" class="mb-ctemp__title">{{ title }}</h2>
        <button v-if="!phone" type="button" class="mb-ctemp__close" aria-label="Close" @click="emit('close')">
          <v-icon icon="$close" size="14" />
        </button>
      </div>
      <template v-if="shown">
        <div class="mb-ctemp__body mb-ctemp__scroll"><slot /></div>
        <div v-if="$slots.actions" class="mb-ctemp__foot"><slot name="actions" /></div>
      </template>
    </div>
  </v-dialog>
</template>

<style scoped src="./MercbotChangeTemplateDialog.css"></style>
<style scoped>
/* A short dialog: as tall as its body, at the frame's narrowest; on a phone the frame fills the screen. */
.mb-dialog-frame:not(.mb-ctemp--phone) {
  width: min(420px, calc(100vw - 48px));
  height: auto;
}
</style>
