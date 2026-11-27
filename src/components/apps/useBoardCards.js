import { computed, shallowRef } from "vue";
import { homeDay } from "@local/apps/shared";

// What a board, a calendar and a timeline (D-140) share: the part's records as cards, their words, a card's click, and
// moving a card, which the server makes as an edit of its record (runtime.move); the lists are read again either way,
// so a refused move goes back where it was, with the reason in the screen's snackbar.

/** Whole days from one day (YYYY-MM-DD) to another. */
export const daysApart = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** A day moved by whole days (YYYY-MM-DD). */
export const addDay = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

/** Monday of a day's week (YYYY-MM-DD). */
export const mondayOf = (day) => addDay(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));

/**
 * @param {{ node: Record<string, any>, path: string }} props the part's
 * @param {import("../../types.js").ScreenRuntime} runtime
 */
export function useBoardCards(props, runtime) {
  const queryName = computed(() => runtime.referenced(props.node.rows));
  const table = computed(() => runtime.queryTable(queryName.value));
  const cards = computed(() => (Array.isArray(runtime.data[queryName.value]) ? runtime.data[queryName.value] : []));
  const loading = computed(() => runtime.loading.has(queryName.value));
  /** The part's field named by a setting (groupBy, date, start, end), or null. */
  const fieldOf = (key) => table.value?.fields.find((field) => !field.obsolete && field.key === props.node[key]) || null;
  const words = (setting, record) => {
    const value = runtime.evaluate(setting, runtime.rowScope(props.node.rows, record));
    return value === undefined || value === null || value === "" ? "" : String(value);
  };
  const titleOf = (record) => words(props.node.title, record) || `#${record.id}`;
  const subtitleOf = (record) => (props.node.subtitle ? words(props.node.subtitle, record) : "");
  /** The day a card's date or start (`key`) is on, in the home's time zone; "" without one. */
  const dayOf = (record, key) => homeDay(record?.[props.node[key]]);
  const movable = computed(() => runtime.moves && props.node.move !== false);
  const open = (record) => props.node.onClick && runtime.run(`${props.path}/onClick`, { row: record.id });
  const move = (record, to) => runtime.move(props.path, record.id, to);
  // The card being dragged (HTML drag and drop); its menu moves it without dragging (keyboards, phones).
  const dragged = shallowRef(null);
  const dropped = () => {
    const record = dragged.value;
    dragged.value = null;
    return record;
  };
  return { table, cards, loading, fieldOf, titleOf, subtitleOf, dayOf, movable, open, move, dragged, dropped };
}
