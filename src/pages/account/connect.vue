<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import { leaveApp } from "@jskit-ai/shell-web/client/navigation/documentNavigation";
import MercbotPluginLogo from "@/components/mercbot/MercbotPluginLogo.vue";
import { pluginsApi } from "@/components/mercbot/pluginsApi.js";
import { setCurrentHome } from "@/components/mercbot/homeApi.js";

// Where an app's sign-in starts (D-31): this tab asks Mercbot for the provider's consent
// screen, through this copy's own app or the hub it's linked to, and goes there.
// When that isn't possible it says why, plainly.
const route = useRoute();
const plugins = ref([]);
const problem = ref("");
const plugin = computed(() => plugins.value.find((entry) => entry.id === route.query.plugin));

onMounted(async () => {
  // The home the sign-in was started in (D-37): its accounts are reached through it.
  setCurrentHome(route.query.home);
  try {
    plugins.value = (await pluginsApi.list()).plugins;
    const account = route.query.account || plugin.value?.accounts.find((entry) => entry.status !== "connected")?.id;
    if (!plugin.value) return;
    if (!account) {
      problem.value = `Add ${plugin.value.name} in Connect apps first, then sign in from there.`;
      return;
    }
    const { url } = await pluginsApi.connect(account);
    // A hand-off page: the provider takes its place, so Back from there doesn't start the sign-in again.
    leaveApp(url, { replace: true });
  } catch (error) {
    problem.value = error?.message || "Signing in didn't start. Close this tab and try again.";
  }
});
</script>

<template>
  <div class="mb-connect-page">
    <div v-if="plugin" class="mb-connect-page__card">
      <MercbotPluginLogo :plugin="plugin" :size="56" />
      <h1 class="mb-connect-page__title">Signing in to {{ plugin.name }}</h1>
      <template v-if="problem">
        <p class="mb-connect-page__text">{{ problem }}</p>
        <p class="mb-connect-page__text">You can close this tab.</p>
      </template>
      <p v-else class="mb-connect-page__text">Taking you to {{ plugin.name }} to approve the link…</p>
    </div>
    <p v-else-if="problem" class="mb-connect-page__text">{{ problem }}</p>
  </div>
</template>

<style scoped>
.mb-connect-page {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
}

.mb-connect-page__card {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 420px;
  text-align: center;
}

.mb-connect-page__title {
  margin: 16px 0 8px;
  font-size: 20px;
  font-weight: 400;
}

.mb-connect-page__text {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 20px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
