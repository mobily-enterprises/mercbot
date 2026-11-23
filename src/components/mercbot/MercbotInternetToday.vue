<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { formatSize, internetApi } from "./filesApi.js";
import { homeChanges } from "./homesApi.js";

// Settings → Spending: what the home's bot commands used of the internet today (UTC), of the most they may in a day,
// and each command's and each bot's own limits (D-127). The day's budget is the whole home's, so everyone sees it.
const emit = defineEmits(["failure"]);
const today = ref(null);
const used = computed(() => (today.value ? today.value.received + today.value.sent : 0));
const share = computed(() => (today.value ? Math.min(100, Math.round((used.value / today.value.homeDay) * 100)) : 0));
const spent = computed(() => Boolean(today.value) && used.value >= today.value.homeDay);

async function load() {
  try {
    today.value = await internetApi.today();
  } catch (error) {
    emit("failure", error);
  }
}

onMounted(load);
watch(homeChanges, load);
</script>

<template>
  <section>
    <p class="mb-set-group">Internet today</p>
    <div v-if="!today" class="mb-internet__loading" aria-hidden="true" />
    <div v-else class="mb-set-card mb-internet">
      <div class="mb-internet__body">
        <p class="mb-internet__label">This home's commands</p>
        <p class="mb-internet__figure" data-testid="internet-today">{{ formatSize(used) }} of {{ formatSize(today.homeDay) }}</p>
        <v-progress-linear
          :model-value="share"
          :color="spent ? 'error' : 'primary'"
          bg-color="surface-container-highest"
          height="6"
          rounded
          :aria-label="`${formatSize(used)} of ${formatSize(today.homeDay)} of internet used today`"
        />
        <p class="mb-internet__note" data-testid="internet-ways">
          Received {{ formatSize(today.received) }}, sent {{ formatSize(today.sent) }}.
          {{ spent ? "Used up: commands reach the internet again" : "It starts again" }} at midnight UTC.
        </p>
      </div>
      <p class="mb-internet__hint">
        Each command may receive {{ formatSize(today.commandIn) }} and send {{ formatSize(today.commandOut) }}, and each
        bot may open {{ today.perMinute }} new connections a minute. A bot whose command goes past one is told why in its
        output.
      </p>
    </div>
  </section>
</template>

<style scoped>
.mb-internet__loading {
  height: 128px;
  margin-bottom: 26px;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-internet__body {
  padding: 16px 18px 12px;
}

.mb-internet__label,
.mb-internet__note,
.mb-internet__hint {
  margin: 0;
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-internet__figure {
  margin: 6px 0 10px;
  font-size: 22px;
  font-weight: 600;
  line-height: 30px;
}

.mb-internet__note {
  margin-top: 10px;
}

.mb-internet__hint {
  padding: 12px 18px;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
  font-size: 12px;
}
</style>
