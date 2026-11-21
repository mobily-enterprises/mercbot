<script setup>
import { ref } from "vue";
import { accountTitle } from "./appsCatalogue.js";
import { pluginsApi } from "./pluginsApi.js";

// Each connected account's Request pace (D-96): how fast Mercbot sends the app requests, as a share of the app's own
// limit. Gentle is every account's until someone who may change the account chooses another: a home's account, its
// owners and admins; a person's own, that person.
const PACES = [
  { id: "gentle", name: "Gentle" },
  { id: "normal", name: "Normal" },
  { id: "fast", name: "Fast" }
];
defineProps({
  plugin: { type: Object, required: true },
  accounts: { type: Array, required: true }
});
const emit = defineEmits(["changed"]);
const busy = ref(false);
const problem = ref("");

// The person who added it and the home's owners and admins (D-111), as the server says.
const mayChange = (account) => Boolean(account.canChange);

async function choose(account, pace) {
  if (account.pace === pace || !mayChange(account)) return;
  busy.value = true;
  problem.value = "";
  try {
    emit("changed", (await pluginsApi.choosePace(account.id, pace)).plugins);
  } catch (error) {
    problem.value = error?.message || "That didn't change.";
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <section class="mb-people" :aria-label="`Request pace for ${plugin.name}`">
    <h3>Request pace</h3>
    <div class="mb-people__box">
      <p class="mb-people__line">
        How fast Mercbot sends {{ plugin.name }} requests: Gentle uses a tenth of what {{ plugin.name }} allows, Normal
        four tenths, Fast nine tenths. When {{ plugin.name }} asks Mercbot to wait, it waits.
      </p>
      <div v-for="account in accounts" :key="account.id" class="mb-people__row">
        <span>{{ accountTitle(account) }}</span>
        <div class="mb-pace" role="radiogroup" :aria-label="`Request pace for ${accountTitle(account)}`">
          <button
            v-for="pace in PACES"
            :key="pace.id"
            type="button"
            role="radio"
            :aria-checked="account.pace === pace.id"
            :disabled="busy || !mayChange(account)"
            @click="choose(account, pace.id)"
          >
            {{ pace.name }}
          </button>
        </div>
      </div>
      <span v-if="problem" class="mb-people__problem" role="alert">{{ problem }}</span>
    </div>
  </section>
</template>

<style scoped src="./MercbotCredentials.css"></style>
<style scoped>
.mb-pace {
  display: inline-flex;
  flex: none;
  padding: 2px;
  border-radius: 14px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-pace button {
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  font: inherit;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-pace button[aria-checked="true"] {
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  box-shadow: var(--mb-shadow-soft);
}

.mb-pace button:disabled {
  cursor: default;
}

.mb-pace button:disabled:not([aria-checked="true"]) {
  opacity: 0.5;
}
</style>
