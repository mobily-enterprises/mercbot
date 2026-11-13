<script setup>
import { computed, defineAsyncComponent, ref, watch } from "vue";
import { accountApi, nanoMoney } from "./accountApi.js";
import { homeChanges } from "./homesApi.js";
import MercbotSettingsSelect from "./MercbotSettingsSelect.vue";
import { KIND_LABELS, PERIODS, barWidths, daysKeptFrom, isoDay, kindAmount, periodRange, rangeProblem, stepPeriod } from "./spendingView.js";

// A spending report (D-76): a day, a week, a month or any range up to a year, as a chart by day and the totals by
// kind, by bot and, for owners and admins, by person; the whole home for its owners and admins, a member's own use
// otherwise; and the same as a CSV. Read from the totals the server keeps by day (13 months) and by month (for good),
// never each call; days are UTC's, as the totals keep them.
const emit = defineEmits(["failure"]);
const MercbotSpendingChart = defineAsyncComponent(() => import("./MercbotSpendingChart.vue"));

const period = ref("month");
const anchor = ref(new Date());
const custom = ref(periodRange("month", new Date()));
const report = ref(null);
const loading = ref(false);

const problem = computed(() => (period.value === "custom" ? rangeProblem(custom.value.from, custom.value.to) : ""));
const range = computed(() => (period.value === "custom" ? { from: custom.value.from, to: custom.value.to, label: "" } : periodRange(period.value, anchor.value)));
// Nothing after today has been spent yet, so the arrow stops at the period holding today; a day or a week stops at
// the first whose daily totals are kept, while a month goes back as far as there are months.
const atLatest = computed(() => period.value !== "custom" && periodRange(period.value, stepPeriod(period.value, anchor.value, 1)).from > isoDay(new Date()));
const atEarliest = computed(() => ["day", "week"].includes(period.value)
  && periodRange(period.value, stepPeriod(period.value, anchor.value, -1)).from < daysKeptFrom());

const ORDER = Object.keys(KIND_LABELS);
const kinds = computed(() => (report.value?.byKind || [])
  .filter((row) => row.spentNano > 0 || row.calls > 0 || row.seconds > 0)
  .sort((a, b) => ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind)));
const bots = computed(() => report.value?.byBot || []);
const people = computed(() => report.value?.byPerson || []);
const botWidths = computed(() => barWidths(bots.value));
const personWidths = computed(() => barWidths(people.value));
const charted = computed(() => (report.value?.byDay.length || 0) > 1 && report.value.totalNano > 0);
// An older month has only its monthly totals (D-76), so it's described as the whole month rather than by day.
const totalNote = computed(() => `${report.value.scope === "own" ? "What your bots did for you" : "Everyone in this home"}, ${report.value.daysKept ? "by day" : "the whole month"} in UTC.`);
const csvUrl = computed(() => (problem.value ? "" : accountApi.spendingExportUrl(range.value)));

async function load() {
  if (problem.value) return;
  const asked = range.value;
  loading.value = true;
  try {
    const answer = await accountApi.spending(asked);
    if (asked === range.value) report.value = answer;
  } catch (error) {
    emit("failure", error);
  } finally {
    loading.value = false;
  }
}

function step(direction) {
  anchor.value = stepPeriod(period.value, anchor.value, direction);
}

watch(range, load, { immediate: true });
watch(homeChanges, load);
defineExpose({ load });
</script>

<template>
  <section>
    <div class="mb-report__head">
      <p class="mb-set-group">{{ report?.scope === "own" ? "Your spending" : "Spending" }}</p>
      <MercbotSettingsSelect v-model="period" :options="PERIODS" label="Period" :width="160" />
    </div>
    <div class="mb-set-card mb-report" data-testid="spending" :aria-busy="loading">
      <div class="mb-set-row mb-report__range">
        <template v-if="period === 'custom'">
          <label class="mb-report__day">From <input v-model="custom.from" type="date" :max="custom.to || undefined" aria-label="First day"></label>
          <label class="mb-report__day">to <input v-model="custom.to" type="date" :min="custom.from || undefined" aria-label="Last day"></label>
        </template>
        <template v-else>
          <button type="button" class="mb-report__step" aria-label="Earlier" :disabled="atEarliest" @click="step(-1)"><v-icon icon="$chevronLeft" size="18" /></button>
          <span class="mb-report__label" data-testid="report-period">{{ range.label }}</span>
          <button type="button" class="mb-report__step" aria-label="Later" :disabled="atLatest" @click="step(1)"><v-icon icon="$chevronRight" size="18" /></button>
        </template>
        <span class="mb-report__spacer" />
        <a v-if="csvUrl" class="mb-set-pill mb-report__csv" :href="csvUrl" download data-testid="spending-csv">
          <v-icon icon="$download" size="14" />Download CSV
        </a>
      </div>
      <p v-if="problem" class="mb-set-row mb-report__hint" role="alert">{{ problem }}</p>

      <template v-else-if="report">
        <div class="mb-set-row mb-report__total">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">Total</span>
            <span class="mb-set-row__description">{{ totalNote }}</span>
          </span>
          <span class="mb-report__figure" data-testid="report-total">{{ nanoMoney(report.totalNano) }}</span>
        </div>
        <p v-if="!report.totalNano && !kinds.length" class="mb-set-row mb-report__hint">Nothing was spent in this period.</p>
        <template v-else>
          <div v-if="charted" class="mb-set-row mb-report__chart">
            <MercbotSpendingChart :days="report.byDay" />
          </div>
          <p v-else-if="!report.daysKept" class="mb-set-row mb-report__hint">Day-by-day totals are kept 13 months; older months keep only their monthly totals, so there's no chart.</p>
          <p class="mb-set-row mb-report__part">By kind</p>
          <div v-for="row in kinds" :key="row.kind" class="mb-set-row mb-report__line">
            <span class="mb-report__name">{{ KIND_LABELS[row.kind] || row.kind }}</span>
            <span class="mb-report__detail">{{ kindAmount(row) }}</span>
            <span class="mb-report__amount">{{ nanoMoney(row.spentNano) }}</span>
          </div>
          <p class="mb-set-row mb-report__part">By bot</p>
          <div v-for="(row, index) in bots" :key="row.botId || 'none'" class="mb-set-row mb-report__line">
            <span class="mb-report__name">{{ row.name || (row.botId ? "A deleted bot" : "Not for a bot") }}</span>
            <span class="mb-report__bar"><span :style="{ width: `${botWidths[index]}%` }" /></span>
            <span class="mb-report__amount">{{ nanoMoney(row.spentNano) }}</span>
          </div>
          <template v-if="report.scope === 'home'">
            <p class="mb-set-row mb-report__part">By person</p>
            <div v-for="(row, index) in people" :key="row.userId || 'none'" class="mb-set-row mb-report__line" data-testid="report-person">
              <span class="mb-report__name">{{ row.name || (row.userId ? "Someone who left" : "Nobody in particular") }}</span>
              <span class="mb-report__bar"><span :style="{ width: `${personWidths[index]}%` }" /></span>
              <span class="mb-report__amount">{{ nanoMoney(row.spentNano) }}</span>
            </div>
          </template>
        </template>
      </template>
      <div v-else class="mb-report__loading" aria-hidden="true" />
    </div>
  </section>
</template>

<style scoped>
.mb-report__head {
  max-width: 636px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.mb-report__head .mb-set-group {
  margin-bottom: 0;
}

.mb-report__loading {
  height: 160px;
}

.mb-set-card .mb-set-row.mb-report__range {
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 10px;
  padding-bottom: 10px;
}

.mb-report__step {
  display: inline-flex;
  padding: 4px;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.mb-report__step:disabled {
  opacity: 0.38;
  cursor: default;
}

.mb-report__label {
  font-size: 14px;
  font-weight: 600;
}

.mb-report__day {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
}

.mb-report__day input {
  height: 30px;
  padding: 0 8px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
  color-scheme: light dark;
}

.mb-report__spacer {
  flex: 1;
}

.mb-report__csv {
  gap: 6px;
  text-decoration: none;
}

.mb-report__chart {
  display: block;
  padding-top: 8px;
  padding-bottom: 8px;
}

.mb-report__figure {
  font-size: 18px;
  font-weight: 600;
}

.mb-report__part {
  margin: 0;
  padding-top: 12px;
  padding-bottom: 4px;
  font-size: 12px;
  font-weight: 600;
  color: rgb(var(--v-theme-on-surface-variant));
}

/* A row's figures stay on its line, on a phone too, where the dialog lets other rows wrap. */
.mb-set-card .mb-set-row.mb-report__line,
.mb-set-card .mb-set-row.mb-report__total {
  flex-wrap: nowrap;
}

.mb-report__line {
  gap: 12px;
  min-height: 36px;
  font-size: 13px;
}

.mb-report__name {
  flex: 0 1 180px;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* On a phone the name gives room to the figures beside it, so "30 AI calls" isn't cut short. */
@media (max-width: 600px) {
  .mb-report__name {
    flex-basis: 112px;
  }
}

.mb-report__bar {
  flex: 1;
  height: 8px;
  border-radius: 4px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-report__bar span {
  display: block;
  height: 100%;
  border-radius: 4px;
  background: rgb(var(--v-theme-secondary));
}

.mb-report__detail {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: rgb(var(--v-theme-on-surface-variant));
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-report__amount {
  flex: none;
  min-width: 72px;
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.mb-report__hint {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
