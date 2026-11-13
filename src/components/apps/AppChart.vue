<script setup>
import { computed } from "vue";
import { useTheme } from "vuetify";
import { ArcElement, BarElement, CategoryScale, Chart, Legend, LinearScale, LineElement, PointElement, Tooltip } from "chart.js";
import { Bar, Line, Pie } from "vue-chartjs";
import { chartData } from "./appRuntime.js";
import { pageMatchesMedia } from "@/browser.js";
import { CHART_SERIES } from "@/theme/palettes.js";

// A chart part (D-35): a totals query drawn as bars, a line or a pie. Loaded only on screens that
// have one. Series take the chart palette (CHART_SERIES), stepped for the light and dark surfaces;
// values and labels stay in the theme's text colours, and a pie's slices are parted by its card's.
Chart.register(ArcElement, BarElement, CategoryScale, LinearScale, LineElement, PointElement, Tooltip, Legend);

const props = defineProps({
  kind: { type: String, default: "bar" },
  label: { type: String, default: "" },
  rows: { type: Array, required: true },
  field: { type: Object, default: null },
  measureField: { type: Object, default: null },
  measure: { type: String, default: "count" }
});

const theme = useTheme();
const dark = computed(() => theme.current.value.dark);
const ink = computed(() => theme.current.value.colors["on-surface-variant"]);
const grid = computed(() => theme.current.value.colors["outline-variant"]);
const chart = computed(() => chartData(props));
const points = computed(() => chart.value.points);
const colours = computed(() => CHART_SERIES[dark.value ? "dark" : "light"]);
const component = computed(() => ({ bar: Bar, line: Line, pie: Pie })[props.kind] || Bar);
const summary = computed(() => `${props.kind === "pie" ? "Pie" : props.kind === "line" ? "Line" : "Bar"} chart${props.label ? ` of ${props.label}` : ""}: ${points.value.map((point) => `${point.label} ${point.text}`).join(", ")}`);

const data = computed(() => {
  const values = points.value.map((point) => point.value);
  const labels = points.value.map((point) => point.label);
  if (props.kind === "pie") {
    return { labels, datasets: [{ data: values, backgroundColor: colours.value.slice(0, values.length), borderColor: theme.current.value.colors["surface-container-low"], borderWidth: 2 }] };
  }
  const colour = colours.value[0];
  return props.kind === "line"
    ? { labels, datasets: [{ data: values, borderColor: colour, backgroundColor: colour, borderWidth: 2, pointRadius: 4, pointHoverRadius: 6, tension: 0 }] }
    : { labels, datasets: [{ data: values, backgroundColor: colour, borderRadius: { topLeft: 4, topRight: 4 }, borderSkipped: "start", maxBarThickness: 48 }] };
});

const options = computed(() => {
  const tooltip = { callbacks: { label: (item) => points.value[item.dataIndex]?.text ?? String(item.raw) } };
  const reduced = pageMatchesMedia("(prefers-reduced-motion: reduce)");
  const base = { responsive: true, maintainAspectRatio: false, animation: reduced ? false : undefined, plugins: { tooltip } };
  if (props.kind === "pie") return { ...base, plugins: { ...base.plugins, legend: { position: "right", labels: { color: ink.value, boxWidth: 12 } } } };
  const axis = { ticks: { color: ink.value }, grid: { color: grid.value }, border: { display: false } };
  return {
    ...base,
    interaction: props.kind === "line" ? { mode: "index", intersect: false } : undefined,
    plugins: { ...base.plugins, legend: { display: false } },
    scales: { x: { ...axis, grid: { display: false } }, y: { ...axis, beginAtZero: true, ticks: { color: ink.value, precision: props.measure === "count" ? 0 : undefined, callback: (value) => chart.value.format(value) } } }
  };
});
</script>

<template>
  <div class="app-chart" role="img" :aria-label="summary">
    <component :is="component" :data="data" :options="options" />
  </div>
</template>

<style scoped>
.app-chart {
  position: relative;
  height: 260px;
}
</style>
