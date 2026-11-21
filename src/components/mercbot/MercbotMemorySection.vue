<script setup>
import { computed, ref } from "vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotIconButton from "./MercbotIconButton.vue";
import { madeLine, noteLine, useBotMemory } from "./useBotMemory.js";

// What a bot remembers (D-113), on its card's Details under its Knowledge: its memory of the home's public chats it's
// in, which everyone in the home may read as they may read those chats, then the home's notes, which people asked a
// bot to tell everyone and every bot reads in every chat. A note's author and the home's owners and admins remove it.
const props = defineProps({
  bot: { type: Object, required: true },
  tab: { type: String, required: true }
});
const emit = defineEmits(["failure"]);

const { memory, notes, next, loaded, loadFailed, removing, loadingMore, hasMemory, load, loadMore, confirmRemove } = useBotMemory({
  bot: () => props.bot,
  tab: computed(() => props.tab),
  onFailure: (error) => emit("failure", error)
});
const expanded = ref(false);
const removeOpen = computed({ get: () => Boolean(removing.value), set: (value) => { if (!value) removing.value = null; } });
</script>

<template>
  <section class="mb-memory" aria-labelledby="mb-memory-title">
    <p id="mb-memory-title" class="mb-memory__label">Memory</p>
    <div v-if="!loaded && !loadFailed" class="mb-memory__skeleton" aria-label="Loading memory" />
    <p v-else-if="loadFailed" class="mb-memory__sentence" role="alert">
      What {{ bot.name }} remembers couldn't be loaded.
      <button type="button" class="mb-memory__link" @click="load">Try again</button>
    </p>
    <template v-else>
      <p class="mb-memory__sentence">
        {{ hasMemory
          ? `What ${bot.name} remembers of the public chats it's in, made ${madeLine(memory.madeAt)}. Private chats are never in it.`
          : `${bot.name} doesn't remember anything yet. It remembers what's said in the public chats it's in, never a private chat.` }}
      </p>
      <div v-if="hasMemory" class="mb-memory__box" :class="{ 'mb-memory__box--open': expanded }" data-memory>
        <p class="mb-memory__text">{{ memory.text }}</p>
      </div>
      <button v-if="hasMemory" type="button" class="mb-memory__link" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? "Show less" : "Show all" }}
      </button>

      <p class="mb-memory__label mb-memory__label--notes">Notes for everyone</p>
      <p class="mb-memory__sentence">
        {{ notes.length
          ? "What people asked a bot to tell everyone in the home. Every bot reads them in every chat."
          : "No notes yet. Ask a bot to tell everyone something, such as a date or an allergy; it asks you first." }}
      </p>
      <ul v-if="notes.length" class="mb-memory__notes" aria-label="Notes for everyone">
        <li v-for="note in notes" :key="note.id" class="mb-memory__note" :data-note="note.text">
          <span class="mb-memory__note-text">
            <span>{{ note.text }}</span>
            <span class="mb-memory__note-line">{{ noteLine(note) }} · {{ madeLine(note.createdAt) }}</span>
          </span>
          <MercbotIconButton
            v-if="note.canRemove"
            icon="$delete"
            :label="`Remove the note: ${note.text}`"
            size="x-small"
            :icon-size="16"
            @click="removing = note"
          />
        </li>
      </ul>
      <button v-if="next" type="button" class="mb-memory__link" :disabled="loadingMore" @click="loadMore">Show older notes</button>
    </template>

    <MercbotConfirmDialog
      v-model="removeOpen"
      title="Remove this note?"
      :text="`Every bot stops reading it from its next reply: “${removing?.text || ''}”`"
      confirm-label="Remove"
      @confirm="confirmRemove"
    />
  </section>
</template>

<style scoped src="./MercbotMemorySection.css"></style>
