<script setup>
import { ref } from "vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import { accountApi } from "./accountApi.js";

// Settings → Computer: your bots' computers. The browser is kept current
// for you, so they're always up to date; Reset, after asking, closes every bot's browser and
// clears what it had saved, such as sign-ins.
const emit = defineEmits(["failure", "notify"]);
const confirming = ref(false);
const resetting = ref(false);

async function reset() {
  resetting.value = true;
  try {
    const { reset: count } = await accountApi.resetComputers();
    emit("notify", count === 1 ? "Your bot's computer was reset" : `Your bots' ${count} computers were reset`);
  } catch (error) {
    emit("failure", error);
  } finally {
    resetting.value = false;
  }
}
</script>

<template>
  <section>
    <p class="mb-set-group">Your bots' computers</p>
    <div class="mb-set-card">
      <div class="mb-set-row mb-computer__row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Update</span>
          <span class="mb-set-row__description">Your bots' browsers are kept up to date for you, all at once. Updating keeps their saved sign-ins.</span>
          <span class="mb-computer__status"><v-icon icon="$checkCircle" size="14" /> Up to date</span>
        </span>
      </div>
      <div class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Reset</span>
          <span class="mb-set-row__description">Starts every bot's computer afresh. Open pages close, and saved sign-ins and website data are cleared.</span>
        </span>
        <button type="button" class="mb-set-pill mb-set-pill--danger" :disabled="resetting" @click="confirming = true">
          {{ resetting ? "Resetting…" : "Reset" }}
        </button>
      </div>
    </div>
    <MercbotConfirmDialog
      v-model="confirming"
      title="Reset your bots' computers?"
      text="Every bot's browser closes and its saved sign-ins and website data are cleared. Your chats, routines and skills stay."
      confirm-label="Reset"
      dim
      @confirm="reset"
    />
  </section>
</template>

<style scoped>
.mb-computer__row {
  align-items: flex-start;
  padding-top: 12px;
  padding-bottom: 12px;
}

.mb-computer__status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  margin-top: 10px;
  padding: 4px 10px;
  border-radius: 8px;
  background: rgba(var(--v-theme-link), 0.1);
  font-size: 13px;
  color: rgb(var(--v-theme-link));
}
</style>
