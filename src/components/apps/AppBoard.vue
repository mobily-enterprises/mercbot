<script setup>
import { computed, inject } from "vue";
import AppBoardCard from "./AppBoardCard.vue";
import { APP_SCREEN_KEY } from "./screenKeys.js";
import { useBoardCards } from "./useBoardCards.js";

// A board (D-140): a column for each choice of a choice field, and the records as cards in theirs. A card dragged to
// another column, or moved with its menu, takes that choice. Records with none come first, under "(none)". The columns
// scroll sideways on a narrow screen.
const props = defineProps({
  node: { type: Object, required: true },
  path: { type: String, required: true }
});
/** @type {import("../../types.js").ScreenRuntime} */
const runtime = inject(APP_SCREEN_KEY);
const { cards, loading, fieldOf, titleOf, subtitleOf, movable, open, move, dragged, dropped } = useBoardCards(props, runtime);

const field = computed(() => fieldOf("groupBy"));
const columns = computed(() => {
  const choices = field.value?.options?.choices || [];
  const key = field.value?.key;
  const of = (choice) => cards.value.filter((record) => (record[key] ?? "") === choice);
  const none = cards.value.filter((record) => !choices.includes(record[key]));
  return [...(none.length ? [{ value: "", label: "(none)", cards: none }] : []), ...choices.map((choice) => ({ value: choice, label: choice, cards: of(choice) }))];
});
const choices = computed(() => columns.value.map(({ value, label }) => ({ value, label })));

function drop(column) {
  const record = dropped();
  if (record && (record[field.value?.key] ?? "") !== column.value) move(record, column.value);
}
</script>

<template>
  <div class="app-board d-flex ga-3 pb-2">
    <section
      v-for="column in columns"
      :key="column.value"
      class="app-board__column rounded-lg pa-2 bg-surface-container-low d-flex flex-column ga-2"
      :aria-label="column.label"
      data-testid="app-board-column"
      @dragover.prevent
      @drop.prevent="drop(column)"
    >
      <div class="text-title-small px-1">
        {{ column.label }} <span class="text-on-surface-variant">· {{ column.cards.length }}</span>
      </div>
      <template v-if="loading">
        <v-skeleton-loader v-for="index in 2" :key="index" type="list-item-two-line" class="rounded-lg" />
      </template>
      <AppBoardCard
        v-for="record in column.cards"
        v-else
        :key="record.id"
        :title="titleOf(record)"
        :subtitle="subtitleOf(record)"
        :clickable="Boolean(node.onClick)"
        :movable="movable"
        :choices="choices.filter((choice) => choice.value !== column.value)"
        @open="open(record)"
        @move="(to) => move(record, to)"
        @drag="dragged = record"
      />
      <div v-if="!loading && !column.cards.length" class="text-body-small text-on-surface-variant px-1 py-2">Nothing here.</div>
    </section>
  </div>
</template>

<style scoped>
.app-board {
  overflow-x: auto;
}
.app-board__column {
  flex: 0 0 272px;
  min-height: 120px;
}
</style>
