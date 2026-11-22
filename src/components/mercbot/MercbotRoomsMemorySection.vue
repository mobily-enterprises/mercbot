<script setup>
import { computed, ref } from "vue";
import { madeLine, useRoomsMemory } from "./useRoomsMemory.js";

// A bot's Rooms memory (D-113, D-119), on its card's Details under its Knowledge: its memory of the home's public
// rooms it's in, which everyone in the home may read as they may read those rooms. Then one line to the home's common
// knowledge, which every bot reads and which lives in Settings (`open-settings` with its section).
const props = defineProps({
  bot: { type: Object, required: true },
  tab: { type: String, required: true }
});
const emit = defineEmits(["failure", "open-settings"]);

const { roomsMemory, commonCount, loaded, loadFailed, hasRoomsMemory, load } = useRoomsMemory({
  bot: () => props.bot,
  tab: computed(() => props.tab),
  onFailure: (error) => emit("failure", error)
});
const expanded = ref(false);
</script>

<template>
  <section class="mb-memory" aria-labelledby="mb-memory-title">
    <p id="mb-memory-title" class="mb-memory__label">Rooms memory</p>
    <div v-if="!loaded && !loadFailed" class="mb-memory__skeleton" aria-label="Loading rooms memory" />
    <p v-else-if="loadFailed" class="mb-memory__sentence" role="alert">
      {{ bot.name }}'s rooms memory couldn't be loaded.
      <button type="button" class="mb-memory__link" @click="load">Try again</button>
    </p>
    <template v-else>
      <p class="mb-memory__sentence">
        {{ hasRoomsMemory ? `From its public rooms, made ${madeLine(roomsMemory.madeAt)}. Never private chats.` : "Nothing yet. It remembers public rooms only, never private chats." }}
      </p>
      <div v-if="hasRoomsMemory" class="mb-memory__box" :class="{ 'mb-memory__box--open': expanded }" data-memory>
        <p class="mb-memory__text">{{ roomsMemory.text }}</p>
      </div>
      <button v-if="hasRoomsMemory" type="button" class="mb-memory__link" :aria-expanded="expanded" @click="expanded = !expanded">
        {{ expanded ? "Show less" : "Show all" }}
      </button>
      <button type="button" class="mb-memory__link mb-memory__common" data-common-knowledge @click="emit('open-settings', 'common-knowledge')">
        {{ bot.name }} also knows the home's common knowledge ({{ commonCount }}) →
      </button>
    </template>
  </section>
</template>

<style scoped src="./MercbotRoomsMemorySection.css"></style>
