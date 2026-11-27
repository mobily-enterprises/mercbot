<script setup>
import { computed, onMounted, ref } from "vue";
import { jobSchedule } from "@local/apps/shared";
import MercbotSwitch from "@/components/mercbot/MercbotSwitch.vue";
import { appsApi, errorText } from "@/components/apps/appsApi.js";
import { whenText } from "@/components/apps/appRuntime.js";

// The Logic tab of an app's details (D-35, scripts): what each script does in plain words, when it
// runs, its code and tests (read-only: only the Builder changes scripts), recent runs and errors,
// the coding loop's rounds, and "Ask Builder to fix"; and which connected apps its scripts may use (D-136), which the
// home's owners and admins choose.
const props = defineProps({ slug: { type: String, required: true } });
const emit = defineEmits(["ask"]);
const scripts = ref(null);
const canManage = ref(false);
const rounds = ref([]);
const problem = ref("");
const open = ref(null);
const view = ref("code");
const connected = ref(null);
const saving = ref(false);
// The bots' and pictures' work its scripts queued (D-136), newest first.
const aiWork = ref([]);
const AI_STATE = { queued: "Waiting", running: "Working", done: "Done", failed: "Failed" };
function aiProgress(job) {
  const state = AI_STATE[job.status] || job.status;
  if (job.kind === "ai_picture") return job.status === "failed" ? `${state}: ${job.error}` : state;
  const count = `${job.done} of ${job.total}`;
  return job.status === "failed" ? `${state} at ${count}: ${job.error}` : `${state} · ${count}`;
}
// The connected apps to choose from, and AI: bots and pictures.
const connectedRows = computed(() => [
  ...(connected.value?.choices || []).map((choice) => ({
    id: choice.id,
    label: choice.name,
    description: "Read from buttons, screens and jobs; changed only by a button someone presses."
  })),
  { id: "ai", label: "AI: bots and pictures", description: "Hand items to the home's bot and make pictures, from buttons and jobs." }
]);

const KIND = { action: "Button", source: "Screen data", rule: "Rule on saving", function: "Formula function", job: "Job" };
function when(script) {
  const settings = script.settings || {};
  if (script.kind === "rule") return `Before ${settings.tableLabel || settings.table} records are ${(settings.on || ["create", "update"]).map((action) => (action === "create" ? "added" : "changed")).join(" or ")}`;
  if (script.kind === "function") return `In formulas: ${script.key}(${(settings.params || []).join(", ")})`;
  if (script.kind === "job" && settings.watch) return `When ${settings.watch.tableLabel || settings.watch.table} records are ${{ create: "added", update: "changed", any: "added or changed" }[settings.watch.on] || "changed"}${settings.watch.condition ? `, if ${settings.watch.condition.slice(1)}` : ""}`;
  if (script.kind === "job") return jobSchedule(settings);
  return script.kind === "action" ? "When a button runs it" : "When a screen shows its data";
}
const lastError = (script) => script.runs.find((run) => !run.ok);
const roundsOf = computed(() => (key) => rounds.value.filter((round) => round.script === key).slice(0, 5));

async function load() {
  problem.value = "";
  try {
    const result = await appsApi.scripts(props.slug);
    scripts.value = result.scripts;
    rounds.value = result.rounds;
    canManage.value = result.canManage;
    connected.value = result.connected;
    aiWork.value = result.aiWork || [];
  } catch (error) {
    problem.value = errorText(error, "The scripts couldn't load.");
  }
}
async function allow(id, on) {
  const wanted = on ? [...connected.value.allowed, id] : connected.value.allowed.filter((entry) => entry !== id);
  saving.value = true;
  try {
    connected.value.allowed = (await appsApi.allowConnected(props.slug, wanted)).allowed;
  } catch (error) {
    problem.value = errorText(error, "That didn't work.");
  } finally {
    saving.value = false;
  }
}
// A misbehaving script can be switched off at once (a broken rule otherwise blocks every save).
async function toggle(script) {
  try {
    script.enabled = (await appsApi.setScriptEnabled(props.slug, script.key, !script.enabled)).enabled;
  } catch (error) {
    problem.value = errorText(error, "That didn't work.");
  }
}
function askToFix(script) {
  const error = lastError(script);
  emit("ask", `script "${script.key}" (${script.summary})${error ? `, which failed with "${error.error}"` : ""}: `);
}
onMounted(load);
</script>

<template>
  <div>
    <v-alert v-if="problem" type="error" variant="tonal" density="compact" class="mb-3">{{ problem }}</v-alert>
    <v-skeleton-loader v-else-if="!scripts" type="list-item-two-line, list-item-two-line" />
    <div v-else-if="!scripts.length" class="text-body-2 text-medium-emphasis">
      No scripts yet. When an app needs logic that formulas can't express (a ranking, a rule checked on every save, a nightly job, a call to another service), ask the Builder: it writes a script with tests.
    </div>
    <v-expansion-panels v-else v-model="open" variant="accordion" class="app-logic">
      <v-expansion-panel v-for="script in scripts" :key="script.key" :value="script.key">
        <v-expansion-panel-title>
          <div class="d-flex flex-column ga-1">
            <div class="d-flex align-center ga-2">
              <span class="text-body-1">{{ script.summary }}</span>
              <v-chip v-if="!script.enabled" size="x-small" variant="tonal" class="flex-shrink-0">Off</v-chip>
              <v-chip v-else-if="lastError(script) && !script.runs[0]?.ok" size="x-small" color="error" variant="tonal" class="flex-shrink-0">Failing</v-chip>
            </div>
            <span class="text-caption text-medium-emphasis">{{ KIND[script.kind] }} · {{ script.key }} · {{ when(script) }} · version {{ script.version }}</span>
          </div>
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <v-btn-toggle v-model="view" density="compact" mandatory class="mb-3">
            <v-btn value="code" size="small">Code</v-btn>
            <v-btn value="tests" size="small">Tests ({{ script.tests.length }})</v-btn>
            <v-btn value="runs" size="small">Runs ({{ script.runs.length }})</v-btn>
          </v-btn-toggle>
          <pre v-if="view === 'code'" class="app-logic__code">{{ script.code }}</pre>
          <v-list v-else-if="view === 'tests'" density="compact" class="pa-0">
            <v-list-item v-for="(item, index) in script.tests" :key="index" :title="item.name || `Test ${index + 1}`">
              <pre class="app-logic__code app-logic__code--small">{{ JSON.stringify({ input: item.input, ...(item.expectError !== undefined ? { expectError: item.expectError } : { expect: item.expect }), ...(item.records ? { records: item.records } : {}) }, null, 2) }}</pre>
            </v-list-item>
          </v-list>
          <template v-else>
            <div v-if="!script.runs.length" class="text-body-2 text-medium-emphasis">It hasn't run yet.</div>
            <v-list v-else density="compact" class="pa-0">
              <v-list-item v-for="(run, index) in script.runs" :key="index" :title="`${run.ok ? 'OK' : 'Failed'} · ${whenText(run.at)}`" :subtitle="[`${run.ms} ms`, `${run.calls} call${run.calls === 1 ? '' : 's'}`, run.via?.kind, run.error].filter(Boolean).join(' · ')">
                <template #prepend><v-icon :color="run.ok ? 'success' : 'error'" size="small" :icon="run.ok ? '$success' : '$error'" /></template>
                <pre v-if="run.log" class="app-logic__code app-logic__code--small">{{ run.log }}</pre>
              </v-list-item>
            </v-list>
          </template>
          <div v-if="roundsOf(script.key).length" class="text-caption text-medium-emphasis mt-3">
            Written by the Builder's coding loop: {{ roundsOf(script.key).slice().reverse().map((round) => `round ${round.round}: ${round.passed} passed, ${round.failed} failed`).join(" · ") }}
          </div>
          <div class="d-flex justify-end ga-2 mt-3">
            <v-btn v-if="canManage" size="small" variant="text" @click="toggle(script)">{{ script.enabled ? "Turn off" : "Turn on" }}</v-btn>
            <v-btn size="small" variant="tonal" color="primary" @click="askToFix(script)">Ask Builder to fix</v-btn>
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>
    <section v-if="aiWork.length" class="app-logic__connected">
      <h3 class="mb-set-group app-logic__group">Work for bots and pictures</h3>
      <div class="mb-set-card">
        <div v-for="job in aiWork" :key="job.id" class="mb-set-row">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">{{ job.title }}</span>
            <span class="mb-set-row__description">{{ aiProgress(job) }} · {{ whenText(job.createdAt) }}</span>
          </span>
        </div>
      </div>
    </section>
    <section v-if="connected" class="app-logic__connected">
      <h3 class="mb-set-group app-logic__group">Connected apps its scripts may use</h3>
      <div class="mb-set-card">
        <div v-for="row in connectedRows" :key="row.id" class="mb-set-row">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">{{ row.label }}</span>
            <span class="mb-set-row__description">{{ row.description }}</span>
          </span>
          <MercbotSwitch
            :model-value="connected.allowed.includes(row.id)"
            :label="row.label"
            :disabled="!canManage || connected.isPublic || saving"
            @update:model-value="(on) => allow(row.id, on)"
          />
        </div>
      </div>
      <p class="text-caption text-medium-emphasis app-logic__note">
        {{
          connected.isPublic
            ? "This app is public, so its scripts can't use connected apps or AI. Make it internal first."
            : !connected.choices.length
              ? "No connected apps in this home yet: connect them in Connect apps."
              : !canManage
                ? "Only the home's owners and admins can change these."
                : "Scripts use them as the person using the app, or the person who turned a job on."
        }}
      </p>
    </section>
  </div>
</template>

<style scoped>
.app-logic__code {
  white-space: pre-wrap;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
  max-height: 50vh;
  overflow: auto;
  padding: 8px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
.app-logic__code--small {
  max-height: 200px;
}
.app-logic__connected {
  margin-top: 24px;
}
.app-logic__group {
  font-weight: 400;
}
.app-logic__note {
  max-width: 636px;
  margin-top: -18px;
}
</style>
