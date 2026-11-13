<script setup>
import { onMounted, ref, watch } from "vue";
import { accountApi, nanoMoney } from "@/components/mercbot/accountApi.js";
import { monthLabel } from "@/components/mercbot/spendingView.js";

// Spending (D-73, D-76): what this month (UTC) cost so far, the whole home's for its owners and admins and a member's
// own use otherwise. Settings → Spending, which reads the same figures for its own use, hands them in.
const props = defineProps({ summary: { type: Object, default: null } });
const usage = ref(props.summary);
const failed = ref(false);

watch(() => props.summary, (value) => {
  if (value) usage.value = value;
});

onMounted(async () => {
  if (usage.value) return;
  try {
    usage.value = await accountApi.usage();
  } catch {
    failed.value = true;
  }
});
</script>

<template>
  <section class="mb-usage">
    <p v-if="failed" class="mb-usage__caption">Your spending couldn't be loaded. Try again in a moment.</p>
    <div v-else-if="!usage" class="mb-usage__card mb-usage__card--loading" aria-hidden="true" />
    <div v-else class="mb-usage__cards">
      <div class="mb-usage__card">
        <p class="mb-usage__label">{{ usage.scope === "home" ? "This home" : "Your use" }} in {{ monthLabel(usage.month, { year: false }) }}</p>
        <p class="mb-usage__figure" data-testid="month-spending">{{ nanoMoney(usage.monthNano) }}</p>
        <p class="mb-usage__reset">
          {{ usage.scope === "home" ? "Every bot's replies, pictures, computer time and commands." : "Your bots' work for you; the home's owners see the whole home." }}
        </p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.mb-usage {
  max-width: 636px;
}

.mb-usage__cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 12px;
}

.mb-usage__card {
  padding: 16px 18px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}

.mb-usage__card--loading {
  height: 128px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-usage__label,
.mb-usage__reset,
.mb-usage__caption {
  margin: 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-usage__figure {
  margin: 6px 0 6px;
  font-size: 22px;
  font-weight: 600;
  line-height: 30px;
}

.mb-usage__caption {
  margin-top: 8px;
}
</style>
