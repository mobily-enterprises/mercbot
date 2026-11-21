<script setup>
import { onMounted, ref } from "vue";
import MercbotAvatar from "@/components/mercbot/MercbotAvatar.vue";
import MercbotIntro from "@/components/mercbot/MercbotIntro.vue";
import MercbotShell from "@/components/mercbot/MercbotShell.vue";
import { ONBOARDING_BLACK } from "@/theme/palettes.js";
import { chatsApi } from "@/components/mercbot/chatsApi.js";
import { useHomes } from "@/components/mercbot/homesApi.js";

// A person's first visit to a home (plan 4.1): with no chats yet, their welcome chat is made, their direct chat with the
// home's main bot (POST /chats/welcome, which makes the main bot too in a new home), then the intro slides when this is
// their first home, and a short pause on Mercbot's face. Anyone who has chats goes straight to the shell.
const phase = ref("loading");
const chats = ref([]);
const sections = ref([]);
const loadFailed = ref(false);
const firstBot = { name: "Mercbot", color: ONBOARDING_BLACK };
const { load: loadHomes } = useHomes();

async function readList() {
  const listed = await chatsApi.list({ hidden: true, archived: true });
  chats.value = listed.chats;
  sections.value = listed.sections;
}

async function load() {
  loadFailed.value = false;
  try {
    await readList();
    if (chats.value.length) {
      phase.value = "shell";
      return;
    }
    await chatsApi.welcome();
    // A new home of someone who already has one skips the slides (D-36).
    if ((await loadHomes()).length > 1) await enter();
    else phase.value = "intro";
  } catch {
    loadFailed.value = true;
  }
}

// After the slides: Mercbot's face a moment, then the shell on the welcome chat.
async function enter() {
  phase.value = "transition";
  try {
    await Promise.all([readList(), new Promise((resolve) => setTimeout(resolve, 2000))]);
    phase.value = "shell";
  } catch {
    phase.value = "loading";
    loadFailed.value = true;
  }
}

onMounted(load);
</script>

<template>
  <MercbotShell v-if="phase === 'shell'" :initial-chats="chats" :initial-sections="sections" />
  <MercbotIntro v-else-if="phase === 'intro'" @finish="enter" />
  <div v-else-if="phase === 'transition'" class="mb-first-run">
    <div class="mb-first-run__avatar"><MercbotAvatar :bot="firstBot" :size="74" /></div>
  </div>
  <div v-else class="mb-first-run mb-first-run--loading">
    <div class="mb-first-run__sidebar" />
    <div v-if="loadFailed" class="mb-first-run__error" role="alert">
      <p>Mercbot couldn't load your chats.</p>
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
