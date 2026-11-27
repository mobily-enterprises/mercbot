<script setup>
import { computed, onMounted, ref } from "vue";
import { jobSchedule } from "@local/apps/shared";
import SelectField from "@jskit-ai/http-web/client/components/SelectField";
import MercbotSwitch from "@/components/mercbot/MercbotSwitch.vue";
import { appsApi, errorText } from "@/components/apps/appsApi.js";
import { SCRIPT_KIND, whenText } from "@/components/apps/appRuntime.js";

// The Logic tab of an app's details (D-35, scripts): what each script does in plain words, when it
// runs, its code and tests (read-only: only the Builder changes scripts), recent runs and errors,
// the coding loop's rounds, and "Ask Builder to fix"; which connected apps its scripts may use (D-136), and what its jobs
// and public forms may send without a button press (D-137), which the home's owners and admins choose.
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
// What its jobs and public forms send by themselves (D-137): notices to members, email from a chosen mailbox, a daily limit.
const sending = ref(null);
async function loadSending() {
  try {
    sending.value = await appsApi.sending(props.slug);
  } catch {
    sending.value = null;
  }
}
async function setSending(change) {
  const next = { ...sending.value.sending, ...change };
  if (next.email && !next.account) next.account = sending.value.mailboxes[0]?.id ?? null;
  saving.value = true;
  try {
    sending.value.sending = (await appsApi.setSending(props.slug, next)).sending;
  } catch (error) {
    problem.value = errorText(error, "That didn't work.");
  } finally {
    saving.value = false;
  }
}
const mailboxItems = computed(() => (sending.value?.mailboxes || []).map((mailbox) => ({ value: mailbox.id, title: mailbox.address })));
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
onMounted(() => {
  load();
  loadSending();
});
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
              <!-- A script changed in the app's draft goes live when the draft is published (D-139). -->
              <v-chip v-if="script.draft === 'removed'" size="x-small" variant="tonal" class="flex-shrink-0" title="Removed in the draft: it stops when the draft is published">Removed in draft</v-chip>
              <v-chip v-else-if="script.draft" size="x-small" color="primary" variant="tonal" class="flex-shrink-0" :title="script.live ? 'Changed in the draft: the live app runs the published version until the draft is published' : 'New in the draft: it runs in the draft\'s preview, and goes live when the draft is published'">Draft</v-chip>
              <v-chip v-if="!script.enabled" size="x-small" variant="tonal" class="flex-shrink-0">Off</v-chip>
              <v-chip v-else-if="lastError(script) && !script.runs[0]?.ok" size="x-small" color="error" variant="tonal" class="flex-shrink-0">Failing</v-chip>
            </div>
            <span class="text-caption text-medium-emphasis">{{ SCRIPT_KIND[script.kind] }} · {{ script.key }} · {{ when(script) }} · version {{ script.version }}</span>
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
    <section v-if="sending" class="app-logic__connected" data-testid="app-sending">
      <h3 class="mb-set-group app-logic__group">What it sends by itself</h3>
      <div class="mb-set-card">
        <div class="mb-set-row">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">Notify members</span>
            <span class="mb-set-row__description">Jobs and forms can message people in the home, from the home's main bot. Today: {{ sending.today.notices }}.</span>
          </span>
          <MercbotSwitch :model-value="sending.sending.notify" label="Notify members" :disabled="!sending.canManage || saving" @update:model-value="(on) => setSending({ notify: on })" />
        </div>
        <div class="mb-set-row">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">Send email</span>
            <span class="mb-set-row__description">Jobs and public forms can send email from one of the home's mailboxes. Today: {{ sending.today.emails }}.</span>
          </span>
          <MercbotSwitch
            :model-value="sending.sending.email"
            label="Send email"
            :disabled="!sending.canManage || saving || (!sending.sending.email && !mailboxItems.length)"
            @update:model-value="(on) => setSending({ email: on })"
          />
        </div>
        <div v-if="sending.canManage && (sending.sending.email || sending.sending.notify)" class="mb-set-row d-flex flex-wrap ga-3">
          <SelectField
            v-if="sending.sending.email"
            :model-value="sending.sending.account"
            :items="mailboxItems"
            :loading="!sending.mailboxes"
            label="From"
            variant="outlined"
            density="compact"
            hide-details
            class="app-logic__field"
            :disabled="saving"
            @update:model-value="(account) => setSending({ account })"
          />
          <v-text-field
            :model-value="sending.sending.daily"
            type="number"
            min="1"
            max="500"
            label="Each a day, at most"
            variant="outlined"
            density="compact"
            hide-details
            class="app-logic__field"
            :disabled="saving"
            @change="(event) => setSending({ daily: Number(event.target.value) })"
          />
        </div>
      </div>
      <p class="text-caption text-medium-emphasis app-logic__note">
        {{
          !sending.canManage
            ? "Only the home's owners and admins can change these."
            : !mailboxItems.length
              ? "To send email, connect a Gmail or Outlook mailbox in Connect apps."
              : "Each send is in the app's activity. A public form emails one address at most 3 times a day."
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
.app-logic__field {
  max-width: 300px;
}
.app-logic__note {
  max-width: 636px;
  margin-top: -18px;
}
</style>
