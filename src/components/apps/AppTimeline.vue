<script setup>
import { computed, inject, ref } from "vue";
import { homeDay, showValue } from "@local/apps/shared";
import AppBoardCard from "./AppBoardCard.vue";
import { APP_SCREEN_KEY } from "./screenKeys.js";
import { addDay, daysApart, mondayOf, useBoardCards } from "./useBoardCards.js";

// A timeline (D-140): four weeks of days, each record a row with its title on the left and a bar from its start to its
// end (in the home's time zone), in lanes by `groupBy` when it's set. A bar dragged to another day, or moved with its
// menu, starts there: its start and end move by as many days. It scrolls sideways on a narrow screen.
const DAYS = 28;
const props = defineProps({
  node: { type: Object, required: true },
  path: { type: String, required: true }
});
/** @type {import("../../types.js").ScreenRuntime} */
const runtime = inject(APP_SCREEN_KEY);
const { cards, loading, fieldOf, titleOf, subtitleOf, dayOf, movable, open, move, dragged, dropped } = useBoardCards(props, runtime);

const today = homeDay(new Date().toISOString());
const cursor = ref(mondayOf(today));
const days = computed(() => Array.from({ length: DAYS }, (_, index) => addDay(cursor.value, index)));
const last = computed(() => days.value.at(-1));
const lane = computed(() => fieldOf("groupBy"));
const dayLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", day: "numeric", month: "short" });

// Each record shown in the four weeks: its lane, and the columns its bar spans (clipped to the weeks shown).
const bars = computed(() => cards.value
  .map((record) => {
    const start = dayOf(record, "start");
    const end = dayOf(record, "end") || start;
    return { record, start, end };
  })
  .filter(({ start, end }) => start && end >= days.value[0] && start <= last.value)
  .map((bar) => ({
    ...bar,
    lane: lane.value ? showValue(lane.value, bar.record[lane.value.key]) : "",
    from: Math.max(0, daysApart(days.value[0], bar.start)),
    span: daysApart(bar.start < days.value[0] ? days.value[0] : bar.start, bar.end > last.value ? last.value : bar.end) + 1
  })));
// A column of titles, then the days.
const columns = `minmax(120px, 200px) repeat(${DAYS}, minmax(32px, 1fr))`;
const lanes = computed(() => [...Map.groupBy(bars.value, (bar) => bar.lane)].sort(([a], [b]) => a.localeCompare(b)));

const moveTo = (bar, day) => move(bar.record, daysApart(bar.start, day));
function drop(day) {
  const record = dropped();
  const bar = record && bars.value.find((entry) => entry.record === record);
  if (bar && bar.start !== day) moveTo(bar, day);
}
</script>

<template>
  <v-card flat class="app-timeline">
    <div class="d-flex align-center ga-2 mb-2">
      <div class="text-title-medium flex-grow-1">{{ dayLabel(days[0]) }} – {{ dayLabel(last) }}</div>
      <v-btn variant="text" size="small" @click="cursor = mondayOf(today)">Today</v-btn>
      <v-btn icon="$chevronLeft" size="small" variant="text" aria-label="Earlier" @click="cursor = addDay(cursor, -7)" />
      <v-btn icon="$chevronRight" size="small" variant="text" aria-label="Later" @click="cursor = addDay(cursor, 7)" />
    </div>
    <v-skeleton-loader v-if="loading" type="table-tbody" />
    <div v-else class="app-timeline__scroll">
      <div class="app-timeline__grid" :style="{ gridTemplateColumns: columns }">
        <div
          v-for="(day, index) in days"
          :key="day"
          class="text-label-small text-center pb-1"
          :class="day === today ? 'text-primary' : 'text-on-surface-variant'"
          :style="{ gridColumn: index + 2 }"
        >
          {{ index % 7 === 0 || day === today ? dayLabel(day) : Number(day.slice(8)) }}
        </div>
        <template v-for="[name, laneBars] in lanes" :key="name">
          <div v-if="lane" class="text-label-medium text-on-surface-variant pt-2" :style="{ gridColumn: `1 / span ${DAYS + 1}` }">{{ name || "(none)" }}</div>
          <template v-for="bar in laneBars" :key="bar.record.id">
            <div
              class="app-timeline__label pr-2"
              :class="{ 'app-clickable': node.onClick }"
              :style="{ gridColumn: 1 }"
              @click="open(bar.record)"
            >
              <div class="text-body-medium app-timeline__title">{{ titleOf(bar.record) }}</div>
              <div v-if="subtitleOf(bar.record)" class="text-body-small text-on-surface-variant app-timeline__title">{{ subtitleOf(bar.record) }}</div>
            </div>
            <div
              class="app-timeline__track bg-surface-container-low rounded"
              :style="{ gridColumn: `2 / span ${DAYS}`, gridTemplateColumns: `repeat(${DAYS}, minmax(32px, 1fr))` }"
            >
              <div
                v-for="(day, index) in days"
                :key="day"
                class="app-timeline__cell"
                :style="{ gridColumn: index + 1 }"
                :aria-label="dayLabel(day)"
                data-testid="app-timeline-day"
                @dragover.prevent
                @drop.prevent="drop(day)"
              />
              <div class="app-timeline__bar" :style="{ gridColumn: `${bar.from + 1} / span ${bar.span}` }">
                <AppBoardCard
                  bar
                  :title="titleOf(bar.record)"
                  :clickable="Boolean(node.onClick)"
                  :movable="movable"
                  :day="bar.start"
                  @open="open(bar.record)"
                  @move="(to) => moveTo(bar, to)"
                  @drag="dragged = bar.record"
                />
              </div>
            </div>
          </template>
        </template>
      </div>
      <div v-if="!bars.length" class="text-body-small text-on-surface-variant py-4">Nothing in these four weeks.</div>
    </div>
  </v-card>
</template>

<style scoped>
.app-timeline__scroll {
  overflow-x: auto;
}
.app-timeline__grid {
  display: grid;
  row-gap: 4px;
  min-width: 1016px;
}
.app-timeline__label {
  min-width: 0;
  align-self: center;
}
.app-timeline__title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.app-clickable {
  cursor: pointer;
}
.app-timeline__track {
  display: grid;
  min-height: 40px;
}
.app-timeline__cell {
  grid-row: 1;
}
.app-timeline__bar {
  grid-row: 1;
  min-width: 0;
  z-index: 1;
}
</style>
