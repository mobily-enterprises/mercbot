<script setup>
import { computed } from "vue";
import { useTheme } from "vuetify";
import { BarElement, CategoryScale, Chart, LinearScale, Tooltip } from "chart.js";
import { Bar } from "vue-chartjs";
import { pageMatchesMedia } from "@/browser.js";
import { CHART_SERIES } from "@/theme/palettes.js";
import { nanoMoney } from "./accountApi.js";
import { dayLabel } from "./spendingView.js";

// A report's spending day by day (D-76), as the Apps' charts draw (AppChart.vue): one series in the chart palette's
// first colour, stepped for light and dark, the axes and labels in the theme's text colours, a figure on hover, and
// the same figures in words for screen readers. Loaded only when Settings → Spending shows a report.
Chart.register(BarElement, CategoryScale, LinearScale, Tooltip);

const props = defineProps({
  days: { type: Array, required: true }
});

const theme = useTheme();
const colour = computed(() => CHART_SERIES[theme.current.value.dark ? "dark" : "light"][0]);
const ink = computed(() => theme.current.value.colors["on-surface-variant"]);
const grid = computed(() => theme.current.value.colors["outline-variant"]);
const summary = computed(() => `Bar chart of spending by day: ${props.days.map((day) => `${dayLabel(day.day)} ${nanoMoney(day.spentNano)}`).join(", ")}`);

const data = computed(() => ({
  labels: props.days.map((day) => dayLabel(day.day)),
  datasets: [{
    data: props.days.map((day) => day.spentNano / 1e9),
    backgroundColor: colour.value,
    borderRadius: { topLeft: 4, topRight: 4 },
    borderSkipped: "start",
    maxBarThickness: 32
  }]
}));

const options = computed(() => {
  const axis = { ticks: { color: ink.value }, grid: { color: grid.value }, border: { display: false } };
  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: pageMatchesMedia("(prefers-reduced-motion: reduce)") ? false : undefined,
    plugins: {
      legend: { display: false },
      tooltip: { callbacks: { label: (item) => nanoMoney(props.days[item.dataIndex]?.spentNano || 0) } }
    },
    scales: {
      x: { ...axis, grid: { display: false }, ticks: { color: ink.value, autoSkip: true, maxRotation: 0 } },
      y: { ...axis, beginAtZero: true, ticks: { color: ink.value, maxTicksLimit: 5, callback: (value) => nanoMoney(value * 1e9) } }
    }
  };
});
</script>

<template>
  <div class="mb-spend-chart" role="img" :aria-label="summary">
    <Bar :data="data" :options="options" />
  </div>
</template>

<style scoped>
.mb-spend-chart {
  position: relative;
  height: 180px;
}
</style>
