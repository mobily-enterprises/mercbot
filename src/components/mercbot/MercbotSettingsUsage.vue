<script setup>
import { onMounted, ref, watch } from "vue";
import AccountSettingsUsageSection from "@/components/account/settings/AccountSettingsUsageSection.vue";
import { accountApi } from "./accountApi.js";
import { homeChanges } from "./homesApi.js";
import MercbotSpendingReport from "./MercbotSpendingReport.vue";

// Settings → Spending (D-73): this month, then a report of any period by day, kind, bot and person (the whole home for
// its owners and admins, a member's own use otherwise) with its CSV, and how spending is counted.
const emit = defineEmits(["failure", "notify"]);
const summary = ref(null);

async function load() {
  try {
    summary.value = await accountApi.usage();
  } catch (error) {
    emit("failure", error);
  }
}

onMounted(load);
watch(homeChanges, load);
</script>

<template>
  <section>
    <p class="mb-set-group">This month</p>
    <AccountSettingsUsageSection v-if="summary" :summary="summary" class="mb-usage-block" />
    <div v-else class="mb-spend__loading mb-usage-block" aria-hidden="true" />

    <MercbotSpendingReport class="mb-usage-block" @failure="emit('failure', $event)" />

    <p class="mb-set-group">How spending is counted</p>
    <div class="mb-set-card mb-usage-block">
      <p class="mb-set-row mb-spend__hint">
        Spending is what your own keys' work costs at the AI providers, as each provider reports it or at its list prices.
        A bot's computer days and its commands are counted as use, with no cost. Days and months are UTC's.
      </p>
    </div>
  </section>
</template>

<style scoped>
.mb-usage-block {
  margin-bottom: 26px;
}

.mb-spend__loading {
  height: 128px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-spend__hint {
  margin: 0;
  font-size: 12px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
