<script setup>
import { computed, onMounted, ref } from "vue";
import { botsApi } from "@/components/mercbot/botsApi.js";

defineProps({
  embedded: { type: Boolean, default: false }
});

// Asking first: auto-review plus plain-language rules, one per action.
const BEHAVIOURS = [
  { title: "Allow without asking", value: "allow" },
  { title: "Always ask", value: "ask" }
];
const behaviourLabel = (value) => BEHAVIOURS.find((entry) => entry.value === value)?.title || value;

const policy = ref(null);
const failed = ref(false);
const draft = ref({ action: "", behaviour: "allow" });
const editingId = ref("");
const editDraft = ref({ action: "", behaviour: "allow" });
const saving = ref(false);
const canAdd = computed(() => Boolean(draft.value.action.trim()) && !saving.value);

async function run(work) {
  saving.value = true;
  try {
    policy.value = await work();
    failed.value = false;
  } catch {
    failed.value = true;
  } finally {
    saving.value = false;
  }
}

onMounted(() => run(() => botsApi.policy()));

function toggleAutoReview() {
  run(() => botsApi.setAutoReview(!policy.value.autoReview));
}

async function addRule() {
  if (!canAdd.value) return;
  await run(() => botsApi.addRule(draft.value));
  if (!failed.value) draft.value = { action: "", behaviour: "allow" };
}

function startEdit(rule) {
  editingId.value = rule.id;
  editDraft.value = { action: rule.action, behaviour: rule.behaviour };
}

async function saveEdit() {
  if (!editDraft.value.action.trim()) return;
  await run(() => botsApi.updateRule(editingId.value, editDraft.value));
  if (!failed.value) editingId.value = "";
}
</script>

<template>
  <v-sheet rounded="lg" color="surface-container-low">
    <!-- Inside the Settings window the group label above already names it. -->
    <header v-if="!embedded" class="pa-4 pb-0">
      <h2 class="text-h6 mb-0">Bots</h2>
    </header>
    <div class="pa-4">
      <div v-if="!policy && !failed" class="mb-bots-skeleton" aria-hidden="true" />
      <p v-else-if="!policy" class="text-body-2 text-error">Your bot settings couldn't load. Reload the page to try again.</p>
      <template v-else>
        <div class="mb-bots-row">
          <div>
            <p class="mb-bots-title">Auto-review</p>
            <p class="mb-bots-text">
              Your bots look over each action before doing it, and ask you first when it changes or sends something.
              Rules below can fine-tune this.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            class="mb-switch"
            :class="{ 'mb-switch--on': policy.autoReview }"
            :aria-checked="policy.autoReview"
            aria-label="Auto-review"
            :disabled="saving"
            @click="toggleAutoReview"
          >
            <span class="mb-switch__knob" />
          </button>
        </div>

        <p class="mb-bots-title mt-6">Your rules</p>
        <p class="mb-bots-text">One short rule per kind of action. If two rules disagree, asking first wins.</p>

        <form class="mb-rule-form" @submit.prevent="addRule">
          <v-text-field
            v-model="draft.action"
            label="When a bot wants to…"
            placeholder="e.g. set up a weekly reminder"
            variant="outlined"
            density="comfortable"
            hide-details
            maxlength="200"
          />
          <div class="mb-rule-form__row">
            <v-select
              v-model="draft.behaviour"
              label="It should…"
              :items="BEHAVIOURS"
              item-title="title"
              item-value="value"
              variant="outlined"
              density="comfortable"
              hide-details
              class="mb-rule-form__select"
            >
              <template #item="{ props: itemProps, item }">
                <v-list-item v-bind="itemProps">
                  <template #append>
                    <v-icon v-if="item.value === draft.behaviour" icon="$check" size="16" />
                  </template>
                </v-list-item>
              </template>
            </v-select>
            <v-btn type="submit" color="inverse-surface" variant="flat" :disabled="!canAdd">Add rule</v-btn>
          </div>
        </form>

        <div v-if="policy.rules.length" class="mb-rules">
          <div class="mb-rules__head">
            <span>Action</span>
            <span>Behaviour</span>
            <span />
          </div>
          <template v-for="rule in policy.rules" :key="rule.id">
            <form v-if="editingId === rule.id" class="mb-rules__edit" @submit.prevent="saveEdit">
              <v-text-field v-model="editDraft.action" label="When a bot wants to…" variant="outlined" density="compact" hide-details maxlength="200" />
              <div class="mb-rule-form__row">
                <v-select
                  v-model="editDraft.behaviour"
                  label="It should…"
                  :items="BEHAVIOURS"
                  item-title="title"
                  item-value="value"
                  variant="outlined"
                  density="compact"
                  hide-details
                  class="mb-rule-form__select"
                />
                <v-btn variant="tonal" @click="editingId = ''">Cancel</v-btn>
                <v-btn type="submit" color="inverse-surface" variant="flat" :disabled="!editDraft.action.trim() || saving">Save rule</v-btn>
              </div>
            </form>
            <div v-else class="mb-rules__row">
              <span>{{ rule.action }}</span>
              <span>{{ behaviourLabel(rule.behaviour) }}</span>
              <span class="mb-rules__actions">
                <v-btn icon="$edit" size="small" variant="text" :aria-label="`Edit rule: ${rule.action}`" @click="startEdit(rule)" />
                <v-btn
                  icon="$delete"
                  size="small"
                  variant="text"
                  :aria-label="`Delete rule: ${rule.action}`"
                  @click="run(() => botsApi.deleteRule(rule.id))"
                />
              </span>
            </div>
          </template>
        </div>

        <p class="mb-bots-note">These rules are yours alone. Mercbot's own safety checks always apply on top.</p>
        <p v-if="failed" class="text-body-2 text-error">That didn't save. Try again.</p>
      </template>
    </div>
  </v-sheet>
</template>

<style scoped>
.mb-bots-skeleton {
  height: 160px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-bots-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.mb-bots-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
}

.mb-bots-text,
.mb-bots-note {
  margin: 2px 0 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-bots-note {
  margin-top: 16px;
  font-size: 12px;
}

.mb-rule-form {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-top: 12px;
}

.mb-rule-form__row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mb-rule-form__select {
  max-width: 260px;
}

.mb-rules {
  margin-top: 16px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
}

.mb-rules__head,
.mb-rules__row {
  display: grid;
  grid-template-columns: 1fr 180px 88px;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 4px 14px;
  font-size: 14px;
}

.mb-rules__head {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-rules__row,
.mb-rules__edit {
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
}

.mb-rules__edit {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px 14px;
}

.mb-rules__actions {
  display: flex;
  justify-content: flex-end;
}

.mb-switch {
  position: relative;
  flex: none;
  width: 36px;
  height: 20px;
  margin-top: 4px;
  padding: 0;
  border: 0;
  border-radius: 10px;
  background: rgb(var(--v-theme-surface-container-high));
  cursor: pointer;
}

.mb-switch--on {
  background: rgb(var(--v-theme-link));
}

.mb-switch__knob {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-lowest));
  box-shadow: 0 1px 2px rgba(var(--v-theme-shadow), 0.2);
  transition: transform 0.15s ease;
}

.mb-switch--on .mb-switch__knob {
  transform: translateX(16px);
}
</style>
