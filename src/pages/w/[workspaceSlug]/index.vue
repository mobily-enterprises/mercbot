<script setup>
import { onMounted, ref } from "vue";
import MercbotAvatar from "@/components/mercbot/MercbotAvatar.vue";
import MercbotIntro from "@/components/mercbot/MercbotIntro.vue";
import MercbotShell from "@/components/mercbot/MercbotShell.vue";
import { ONBOARDING_BLACK } from "@/theme/palettes.js";
import { botsApi } from "@/components/mercbot/botsApi.js";
import { useHomes } from "@/components/mercbot/homesApi.js";

// First run: intro slides, then a short transition while the first bot is created.
// Returning users go straight to the shell.
const phase = ref("loading");
const bots = ref([]);
const sections = ref([]);
const loadFailed = ref(false);
const firstBot = { name: "Mercbot", color: ONBOARDING_BLACK };
const { load: loadHomes } = useHomes();

async function load() {
  loadFailed.value = false;
  try {
    const result = await botsApi.list();
    bots.value = result.bots;
    sections.value = result.sections;
    if (bots.value.length) phase.value = "shell";
    // A new home of someone who already has one skips the welcome and makes its first bot (D-36).
    else if ((await loadHomes()).length > 1) await finishIntro();
    else phase.value = "intro";
  } catch {
    loadFailed.value = true;
  }
}

async function finishIntro() {
  phase.value = "transition";
  const pause = new Promise((resolve) => setTimeout(resolve, 2000));
  try {
    await botsApi.createFirst();
    const [result] = await Promise.all([botsApi.list(), pause]);
    bots.value = result.bots;
    sections.value = result.sections;
    phase.value = "shell";
  } catch {
    phase.value = "loading";
    loadFailed.value = true;
  }
}

onMounted(load);
</script>

<template>
  <MercbotShell v-if="phase === 'shell'" :initial-bots="bots" :initial-sections="sections" />
  <MercbotIntro v-else-if="phase === 'intro'" @finish="finishIntro" />
  <div v-else-if="phase === 'transition'" class="mb-first-run">
    <div class="mb-first-run__avatar"><MercbotAvatar :bot="firstBot" :size="74" /></div>
  </div>
  <div v-else class="mb-first-run mb-first-run--loading">
    <div class="mb-first-run__sidebar" />
    <div v-if="loadFailed" class="mb-first-run__error" role="alert">
      <p>Mercbot couldn't load your bots.</p>
      <v-btn variant="tonal" @click="load">Try again</v-btn>
    </div>
  </div>
</template>

<style scoped>
.mb-first-run {
  position: fixed;
  inset: 0;
  background: rgb(var(--v-theme-background));
}

.mb-first-run__avatar {
  position: absolute;
  top: max(0px, calc((100vh - 760px) / 2 + 222px));
  left: 50%;
  transform: translateX(-50%);
}

.mb-first-run--loading {
  display: flex;
}

.mb-first-run__sidebar {
  width: 280px;
  height: 100%;
  border-right: 1px solid rgb(var(--v-theme-outline-variant));
  background: rgb(var(--v-theme-surface-container-low));
}

.mb-first-run__error {
  display: flex;
  flex: 1;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  font-size: 14px;
}
</style>
