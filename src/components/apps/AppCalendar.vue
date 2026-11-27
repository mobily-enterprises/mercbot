<script setup>
import { computed, inject, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { homeDay } from "@local/apps/shared";
import AppBoardCard from "./AppBoardCard.vue";
import { APP_SCREEN_KEY } from "./screenKeys.js";
import { addDay, daysApart, mondayOf, useBoardCards } from "./useBoardCards.js";

// A calendar (D-140): a month of weeks (or one week, `span`), each record a card on the day of its date, in the home's
// time zone. A card dragged to another day, or moved with its menu, moves its date (and its end) by as many days. On a
// narrow screen it is a list of the week's days. It shows the records its query reads: the query picks the range.
const props = defineProps({
  node: { type: Object, required: true },
  path: { type: String, required: true }
});
/** @type {import("../../types.js").ScreenRuntime} */
const runtime = inject(APP_SCREEN_KEY);
const { cards, loading, titleOf, subtitleOf, dayOf, movable, open, move, dragged, dropped } = useBoardCards(props, runtime);
const display = useDisplay();

const today = homeDay(new Date().toISOString());
const week = computed(() => props.node.span === "week" || display.smAndDown.value);
// The first day shown: a week's Monday, or the first of the month.
const todayStart = () => (week.value ? mondayOf(today) : `${today.slice(0, 7)}-01`);
const cursor = ref(todayStart());
const days = computed(() => {
  if (week.value) return Array.from({ length: 7 }, (_, index) => addDay(mondayOf(cursor.value), index));
  const first = `${cursor.value.slice(0, 7)}-01`;
  const start = mondayOf(first);
  const weeks = Math.ceil((daysApart(start, first) + new Date(Date.UTC(Number(first.slice(0, 4)), Number(first.slice(5, 7)), 0)).getUTCDate()) / 7);
  return Array.from({ length: weeks * 7 }, (_, index) => addDay(start, index));
});
const month = computed(() => cursor.value.slice(0, 7));
const heading = computed(() => {
  const format = (day, options) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", ...options });
  if (!week.value) return format(`${month.value}-01`, { month: "long", year: "numeric" });
  return `${format(days.value[0], { day: "numeric", month: "short" })} – ${format(days.value[6], { day: "numeric", month: "short", year: "numeric" })}`;
});
const byDay = computed(() => Map.groupBy(cards.value.filter((record) => dayOf(record, "date")), (record) => dayOf(record, "date")));
const weekdays = computed(() => days.value.slice(0, 7).map((day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "short" })));
const dayLabel = (day) => new Date(`${day}T00:00:00Z`).toLocaleDateString(undefined, { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });

function step(direction) {
  if (week.value) {
    cursor.value = addDay(mondayOf(cursor.value), 7 * direction);
    return;
  }
  const [year, monthNumber] = month.value.split("-").map(Number);
  cursor.value = new Date(Date.UTC(year, monthNumber - 1 + direction, 1)).toISOString().slice(0, 10);
}
const goToday = () => (cursor.value = todayStart());
// A screen turned narrow (a week) or wide (a month) starts again from today.
watch(week, goToday);
const moveTo = (record, day) => move(record, daysApart(dayOf(record, "date"), day));
function drop(day) {
  const record = dropped();
  if (record && dayOf(record, "date") !== day) moveTo(record, day);
}
</script>

<template>
  <v-card flat class="app-calendar">
    <div class="d-flex align-center ga-2 mb-2">
      <div class="text-title-medium flex-grow-1">{{ heading }}</div>
      <v-btn variant="text" size="small" @click="goToday">Today</v-btn>
      <v-btn icon="$chevronLeft" size="small" variant="text" :aria-label="week ? 'Previous week' : 'Previous month'" @click="step(-1)" />
      <v-btn icon="$chevronRight" size="small" variant="text" :aria-label="week ? 'Next week' : 'Next month'" @click="step(1)" />
    </div>
    <v-skeleton-loader v-if="loading" type="table-tbody" />
    <div v-else-if="week" class="d-flex flex-column ga-2">
      <section
        v-for="day in days"
        :key="day"
        class="rounded-lg pa-2 bg-surface-container-low"
        :aria-label="dayLabel(day)"
        data-testid="app-calendar-day"
        @dragover.prevent
        @drop.prevent="drop(day)"
      >
        <div class="text-label-medium mb-1" :class="day === today ? 'text-primary' : 'text-on-surface-variant'">{{ dayLabel(day) }}</div>
        <div class="d-flex flex-column ga-1">
          <AppBoardCard
            v-for="record in byDay.get(day) || []"
            :key="record.id"
            :title="titleOf(record)"
            :subtitle="subtitleOf(record)"
            :clickable="Boolean(node.onClick)"
            :movable="movable"
            :day="day"
            @open="open(record)"
            @move="(to) => moveTo(record, to)"
            @drag="dragged = record"
          />
        </div>
      </section>
    </div>
    <div v-else class="app-calendar__month">
      <div v-for="name in weekdays" :key="name" class="text-label-medium text-on-surface-variant text-center pb-1">{{ name }}</div>
      <section
        v-for="day in days"
        :key="day"
        class="app-calendar__day rounded pa-1 d-flex flex-column ga-1"
        :class="{ 'bg-surface-container-low': day.slice(0, 7) === month }"
        :aria-label="dayLabel(day)"
        data-testid="app-calendar-day"
        @dragover.prevent
        @drop.prevent="drop(day)"
      >
        <div class="text-label-medium" :class="day === today ? 'text-primary' : 'text-on-surface-variant'">{{ Number(day.slice(8)) }}</div>
        <AppBoardCard
          v-for="record in byDay.get(day) || []"
          :key="record.id"
          dense
          :title="titleOf(record)"
          :clickable="Boolean(node.onClick)"
          :movable="movable"
          :day="day"
          @open="open(record)"
          @move="(to) => moveTo(record, to)"
          @drag="dragged = record"
        />
      </section>
    </div>
  </v-card>
</template>

<style scoped>
.app-calendar__month {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  gap: 4px;
}
.app-calendar__day {
  min-height: 96px;
  min-width: 0;
}
</style>
