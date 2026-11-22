<script setup>
import { computed, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import SelectField from "@jskit-ai/http-web/client/components/SelectField";
import MercbotAvatar from "./MercbotAvatar.vue";
import { chatTitle } from "./chatView.js";
import { inviteChoices } from "./chatMenus.js";
import { initialsOf } from "./messageAuthors.js";

// Invite (plan 4.6), from a room's header and right after a private room is made: the home's people and bots not in it
// yet, picked as chips in one field that filters as the person types. A private room takes people and bots ("Invite");
// a public room, which everyone in the home can open already, takes bots ("Invite a bot"). Add emits each pick, for the
// shell to add one by one.
const open = defineModel({ type: Boolean, default: false });
const props = defineProps({
  chat: { type: Object, default: null },
  // The home's people and bots (useTeam), the person among them.
  people: { type: Array, default: () => [] },
  bots: { type: Array, default: () => [] },
  me: { type: String, default: "" },
  // While the home's people or bots are still being read.
  loading: { type: Boolean, default: false }
});
const emit = defineEmits(["add"]);

const display = useDisplay();
const phone = computed(() => display.width.value < 600);
const picked = ref([]);
watch(open, (value) => {
  if (value) picked.value = [];
});

const privateRoom = computed(() => props.chat?.kind === "private");
const heading = computed(() => (privateRoom.value ? "Invite" : "Invite a bot"));
const choices = computed(() => (props.chat ? inviteChoices(props.chat, { people: props.people, bots: props.bots, me: props.me }) : []));
const name = computed(() => (props.chat ? chatTitle(props.chat, props.me) : ""));

function add() {
  const chosen = picked.value.map((value) => choices.value.find((choice) => choice.value === value)).filter(Boolean);
  if (!chosen.length) return;
  emit("add", chosen.map(({ kind, id }) => ({ kind, id })));
  open.value = false;
}
</script>

<template>
  <v-dialog v-model="open" width="auto" :fullscreen="phone">
    <div v-if="chat" class="mb-ctemp mb-invite" :class="{ 'mb-ctemp--phone': phone }" role="dialog" :aria-label="heading">
      <div class="mb-ctemp__head">
        <h2 class="mb-ctemp__title">{{ heading }}</h2>
        <button type="button" class="mb-ctemp__close" aria-label="Close" @click="open = false">
          <v-icon icon="$close" :size="phone ? 18 : 14" />
        </button>
      </div>

      <form class="mb-ctemp__body mb-invite__body" @submit.prevent="add">
        <div class="mb-ctemp__scroll mb-invite__fields">
          <p class="mb-invite__note">
            {{ privateRoom
              ? `Whoever you invite to “${name}” sees everything said here, from its start.`
              : `Everyone in the home can open “${name}” already. A bot you invite answers here, and can be taken out again.` }}
          </p>
          <SelectField
            v-model="picked"
            searchable
            :items="choices"
            :loading="loading"
            item-title="title"
            item-value="value"
            :label="privateRoom ? 'People and bots' : 'Bots'"
            :no-data-text="privateRoom ? 'Everyone is in this room already.' : 'Every bot is in this room already.'"
            multiple
            chips
            closable-chips
            auto-select-first
            hide-details
            variant="outlined"
            density="comfortable"
            autofocus
          >
            <template #chip="{ props: chipProps, item }">
              <v-chip v-bind="chipProps" size="small">
                <template #prepend>
                  <MercbotAvatar v-if="item.raw.bot" :bot="item.raw.bot" :size="16" still class="mb-invite__face" />
                  <span v-else class="mb-invite__initials">{{ initialsOf(item.raw.title) }}</span>
                </template>
                {{ item.raw.title }}
              </v-chip>
            </template>
            <template #item="{ props: itemProps, item }">
              <v-list-item v-bind="itemProps" :subtitle="item.raw.kind === 'bot' ? 'Bot' : 'Person'">
                <template #prepend>
                  <MercbotAvatar v-if="item.raw.bot" :bot="item.raw.bot" :size="24" still class="mb-invite__face" />
                  <span v-else class="mb-invite__initials mb-invite__initials--row">{{ initialsOf(item.raw.title) }}</span>
                </template>
              </v-list-item>
            </template>
          </SelectField>
        </div>
        <div class="mb-ctemp__foot">
          <button type="button" class="mb-ctemp__button" @click="open = false">Cancel</button>
          <button type="submit" class="mb-ctemp__button mb-ctemp__button--primary" :disabled="!picked.length">Add</button>
        </div>
      </form>
    </div>
  </v-dialog>
</template>

<style scoped src="./MercbotChangeTemplateDialog.css"></style>
<style scoped>
/* One field: as tall as it needs, not the size of a gallery. */
.mb-invite:not(.mb-ctemp--phone) {
  width: min(480px, calc(100vw - 48px));
  height: auto;
}

.mb-invite__body {
  display: flex;
  flex-direction: column;
}

.mb-invite__fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.mb-invite__note {
  margin: 0;
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-invite__face {
  margin-right: 6px;
}

.mb-invite__initials {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-highest));
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 7px;
  font-weight: 700;
}

.mb-invite__initials--row {
  width: 24px;
  height: 24px;
  margin-right: 12px;
  font-size: 9px;
}
</style>
