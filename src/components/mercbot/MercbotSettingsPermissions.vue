<script setup>
import { nextTick, onMounted, ref } from "vue";
import MercbotSwitch from "./MercbotSwitch.vue";
import { botsApi } from "./botsApi.js";

// Settings → Permissions: the auto-review switch, then the person's own rules in
// two lists, what always needs their yes and what bots may do without asking. If two rules
// disagree, asking wins.
const emit = defineEmits(["failure"]);
const LISTS = [
  { behaviour: "ask", title: "Always ask", text: "Stop and ask you when an action matches one of these rules.", placeholder: "e.g. send an email to someone new" },
  { behaviour: "allow", title: "Allow without asking", text: "Carry on without asking when an action matches one of these rules.", placeholder: "e.g. add events to my calendar" }
];
const policy = ref(null);
const saving = ref(false);
const adding = ref("");
const draft = ref("");
const inputs = ref({});

async function run(work) {
  saving.value = true;
  try {
    policy.value = await work();
  } catch (error) {
    emit("failure", error);
  } finally {
    saving.value = false;
  }
}

onMounted(() => run(() => botsApi.policy()));

function setAutoReview(value) {
  run(() => botsApi.setAutoReview(value));
}

async function startAdding(behaviour) {
  adding.value = behaviour;
  draft.value = "";
  await nextTick();
  inputs.value[behaviour]?.focus();
}

async function add() {
  const action = draft.value.trim();
  if (!action || saving.value) return;
  await run(() => botsApi.addRule({ action, behaviour: adding.value }));
  adding.value = "";
}

function remove(rule) {
  run(() => botsApi.deleteRule(rule.id));
}
</script>

<template>
  <section v-if="policy">
    <div class="mb-set-card">
      <div class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Auto-review</span>
          <span class="mb-set-row__description">Your bots review each action against your rules below, and ask you first when it changes or sends something.</span>
        </span>
        <MercbotSwitch :model-value="policy.autoReview" label="Auto-review" :disabled="saving" @update:model-value="setAutoReview" />
      </div>
    </div>

    <template v-for="list in LISTS" :key="list.behaviour">
      <div class="mb-perm__head">
        <span>
          <span class="mb-set-group mb-perm__title">{{ list.title }}</span>
          <span class="mb-perm__text">{{ list.text }}</span>
        </span>
        <button type="button" class="mb-set-pill" :disabled="adding === list.behaviour" @click="startAdding(list.behaviour)">Add rule</button>
      </div>
      <div v-if="adding === list.behaviour || policy.rules.some((rule) => rule.behaviour === list.behaviour)" class="mb-set-card">
        <div v-for="rule in policy.rules.filter((entry) => entry.behaviour === list.behaviour)" :key="rule.id" class="mb-set-row">
          <span class="mb-set-row__text"><span class="mb-set-row__label mb-perm__rule">{{ rule.action }}</span></span>
          <button type="button" class="mb-perm__remove" :aria-label="`Delete rule: ${rule.action}`" :disabled="saving" @click="remove(rule)">
            <v-icon icon="$close" size="16" />
          </button>
        </div>
        <form v-if="adding === list.behaviour" class="mb-set-row mb-perm__form" @submit.prevent="add" @keydown.esc.stop="adding = ''">
          <input
            :ref="(element) => (inputs[list.behaviour] = element)"
            v-model="draft"
            class="mb-perm__input"
            :placeholder="list.placeholder"
            :aria-label="`New rule: ${list.title}`"
            maxlength="200"
          >
          <button type="button" class="mb-set-pill" @click="adding = ''">Cancel</button>
          <button type="submit" class="mb-set-pill mb-set-pill--dark" :disabled="!draft.trim() || saving">Add</button>
        </form>
      </div>
      <p v-else class="mb-perm__empty">No rules yet.</p>
    </template>
  </section>
</template>

<style scoped>
.mb-perm__head {
  display: flex;
  gap: 16px;
  align-items: flex-end;
  justify-content: space-between;
  margin-top: 24px;
}

.mb-perm__title {
  display: block;
  margin-bottom: 2px;
}

.mb-perm__text {
  display: block;
  margin-bottom: 8px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-perm__head .mb-set-pill {
  flex: none;
  margin-bottom: 8px;
}

.mb-perm__rule {
  font-weight: 400;
  white-space: normal;
}

.mb-perm__remove {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-perm__remove:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-perm__form {
  gap: 8px;
}

.mb-perm__input {
  flex: 1;
  min-width: 0;
  height: 32px;
  padding: 0 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  outline: none;
}

.mb-perm__input:focus {
  border-color: rgb(var(--v-theme-on-surface));
}

.mb-perm__empty {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
