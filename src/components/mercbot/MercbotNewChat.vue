<script setup>
import { computed, ref } from "vue";
import { useDisplay } from "vuetify";
import { KIND_MEANS } from "./chatView.js";

// New room (plan 4.3, D15), from Rooms' +: Public (the default) or Private, which can't change later, and its name,
// which it needs. Create makes it with the person in it and no one else; what the server says of the name shows under
// it. Opened by Continue with others (D-114), it says the direct chat's bot comes along with its note. On a phone it
// fills the screen.
const props = defineProps({
  // { kind, name, problem, continuing?: { chatId, botId } } while it's open, else null.
  choice: { type: Object, default: null },
  // The home's active bots, to name the one that comes along.
  bots: { type: Array, default: () => [] },
  homeName: { type: String, default: "this home" },
  starting: { type: Boolean, default: false }
});
const emit = defineEmits(["change", "close", "start"]);

const display = useDisplay();
const phone = computed(() => display.width.value < 600);
const nameInput = ref(null);
const continuedBot = computed(() => props.bots.find((bot) => String(bot.id) === props.choice?.continuing?.botId) || null);
</script>

<template>
  <v-dialog
    :model-value="Boolean(choice)"
    width="auto"
    :fullscreen="phone"
    :persistent="starting"
    @update:model-value="!$event && emit('close')"
    @after-enter="nameInput?.focus()"
  >
    <div v-if="choice" class="mb-ctemp mb-new-chat" :class="{ 'mb-ctemp--phone': phone }" role="dialog" aria-label="New room">
      <div class="mb-ctemp__head">
        <h2 class="mb-ctemp__title">New room</h2>
        <button type="button" class="mb-ctemp__close" aria-label="Close" :disabled="starting" @click="emit('close')">
          <v-icon icon="$close" :size="phone ? 18 : 14" />
        </button>
      </div>

      <form class="mb-ctemp__body mb-new-chat__body" @submit.prevent="emit('start')">
        <div class="mb-ctemp__scroll mb-new-chat__fields">
          <div class="mb-new-chat__kinds" role="radiogroup" aria-label="Who can open it">
            <label class="mb-new-chat__kind" :class="{ 'mb-new-chat__kind--chosen': choice.kind !== 'private' }">
              <input
                type="radio"
                name="mb-new-chat-kind"
                value="public"
                :checked="choice.kind !== 'private'"
                @change="emit('change', { kind: 'public' })"
              >
              <v-icon icon="$language" size="18" class="mb-new-chat__kind-icon" />
              <span class="mb-new-chat__kind-text">
                <span class="mb-new-chat__kind-name">Public</span>
                <span class="mb-new-chat__kind-line">{{ KIND_MEANS.public(homeName) }}</span>
              </span>
            </label>
            <label class="mb-new-chat__kind" :class="{ 'mb-new-chat__kind--chosen': choice.kind === 'private' }">
              <input
                type="radio"
                name="mb-new-chat-kind"
                value="private"
                :checked="choice.kind === 'private'"
                @change="emit('change', { kind: 'private' })"
              >
              <v-icon icon="$lock" size="18" class="mb-new-chat__kind-icon" />
              <span class="mb-new-chat__kind-text">
                <span class="mb-new-chat__kind-name">Private</span>
                <span class="mb-new-chat__kind-line">{{ KIND_MEANS.private() }}</span>
              </span>
            </label>
          </div>
          <p class="mb-new-chat__fixed">You can't change this once the room has started.</p>
          <p v-if="choice.continuing" class="mb-new-chat__continuing" role="status">
            <v-icon icon="$forkRight" size="16" />
            <span>{{ continuedBot?.name || "The bot" }} comes along, and its note for the others is ready to send.</span>
          </p>

          <label class="mb-new-chat__label" for="mb-new-chat-name">Name</label>
          <input
            id="mb-new-chat-name"
            ref="nameInput"
            class="mb-new-chat__name"
            :value="choice.name"
            maxlength="80"
            aria-required="true"
            placeholder="For example, Kitchen renovation"
            :aria-invalid="Boolean(choice.problem)"
            :aria-describedby="choice.problem ? 'mb-new-chat-problem' : undefined"
            @input="emit('change', { name: $event.target.value })"
          >
          <p v-if="choice.problem" id="mb-new-chat-problem" class="mb-new-chat__problem" role="alert">{{ choice.problem }}</p>
        </div>
        <div class="mb-ctemp__foot">
          <button type="button" class="mb-ctemp__button" :disabled="starting" @click="emit('close')">Cancel</button>
          <button type="submit" class="mb-ctemp__button mb-ctemp__button--primary" :disabled="starting">
            {{ starting ? "Creating…" : "Create" }}
          </button>
        </div>
      </form>
    </div>
  </v-dialog>
</template>

<style scoped src="./MercbotChangeTemplateDialog.css"></style>
<style scoped>
/* A choice and a name: as tall as it needs, not the size of a gallery. */
.mb-new-chat:not(.mb-ctemp--phone) {
  width: min(560px, calc(100vw - 48px));
  height: auto;
}

.mb-new-chat__body {
  display: flex;
  flex-direction: column;
}

.mb-new-chat__fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mb-new-chat__kinds {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

@media (max-width: 599px) {
  .mb-new-chat__kinds {
    grid-template-columns: 1fr;
  }
}

.mb-new-chat__kind {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
  cursor: pointer;
}

.mb-new-chat__kind input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}

.mb-new-chat__kind:focus-within {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 1px;
}

.mb-new-chat__kind--chosen {
  border-color: rgb(var(--v-theme-primary));
  background: rgb(var(--v-theme-secondary-container));
}

.mb-new-chat__kind-icon {
  flex: none;
  margin-top: 1px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-new-chat__kind-text {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mb-new-chat__kind-name {
  font-size: 14px;
  font-weight: 600;
}

.mb-new-chat__kind-line {
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-new-chat__continuing {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin: 0;
  padding: 10px 12px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface));
}

.mb-new-chat__fixed {
  margin: 0;
  font-size: 12px;
  line-height: 17px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-new-chat__label {
  margin-top: 4px;
  font-size: 13px;
  font-weight: 600;
}

.mb-new-chat__name {
  width: 100%;
  height: 44px;
  padding: 0 12px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 10px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  font-size: 15px;
}

.mb-new-chat__name:focus {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 0;
}

.mb-new-chat__name[aria-invalid="true"] {
  border-color: rgb(var(--v-theme-error));
}

.mb-new-chat__problem {
  margin: 0;
  font-size: 12px;
  line-height: 17px;
  color: rgb(var(--v-theme-error));
}
</style>
