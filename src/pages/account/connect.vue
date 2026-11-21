<script setup>
import { computed, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { leaveApp } from "@jskit-ai/shell-web/client/navigation/documentNavigation";
import MercbotPluginLogo from "@/components/mercbot/MercbotPluginLogo.vue";
import { pluginsApi } from "@/components/mercbot/pluginsApi.js";
import { setCurrentHome } from "@/components/mercbot/homeApi.js";
import { rememberSignInStart, signInInThisTab, takeWayBack } from "@/components/mercbot/signInReturn.js";

// Where an app's sign-in starts (D-31): this tab asks Mercbot for the provider's consent
// screen, through this copy's own app or the hub it's linked to, and goes there.
// When that isn't possible it says why, plainly, with Close: it closes the sign-in's own window, or, in a tab the
// sign-in took (on a phone), goes back to where it began in Mercbot (D-110). It leaves its own
// address for the page the sign-in ends on, whose Try again starts it again. On a hub, `lent` is a sign-in a copy linked
// to the person's account asked for: it begins here, signed in, so it's tied to this browser (D-97).
const route = useRoute();
const router = useRouter();
const plugins = ref([]);
const problem = ref("");
const wayBack = ref("/");
// A window the browser won't let this page close: it says to close the tab instead.
const closeRefused = ref(false);

function close() {
  if (signInInThisTab()) {
    router.replace(wayBack.value);
    return;
  }
  window.close();
  setTimeout(() => {
    closeRefused.value = true;
  }, 300);
}
const lent = computed(() => String(route.query.lent || ""));
const lentApp = ref("");
const plugin = computed(() => plugins.value.find((entry) => entry.id === route.query.plugin));

async function beginLent() {
  try {
    const { url, app } = await pluginsApi.beginLentSignIn(lent.value);
    lentApp.value = app || "";
    leaveApp(url, { replace: true });
  } catch (error) {
    problem.value = error?.message || "Signing in didn't start. Close this tab and start again from your copy of Mercbot.";
  }
}

onMounted(async () => {
  if (lent.value) {
    await beginLent();
    return;
  }
  // The home the sign-in was started in (D-37): its accounts are reached through it.
  setCurrentHome(route.query.home);
  rememberSignInStart();
  try {
    plugins.value = (await pluginsApi.list()).plugins;
    const account = route.query.account || plugin.value?.accounts.find((entry) => entry.status !== "connected")?.id;
    if (!plugin.value) return;
    if (!account) {
      problem.value = `Add an account of ${plugin.value.name} in Connect apps first, then sign in from there.`;
      wayBack.value = takeWayBack() || "/";
      return;
    }
    const { url } = await pluginsApi.connect(account);
    // A hand-off page: the provider takes its place, so Back from there doesn't start the sign-in again.
    leaveApp(url, { replace: true });
  } catch (error) {
    problem.value = error?.message || "Signing in didn't start. Try again from Connect apps.";
    wayBack.value = takeWayBack() || "/";
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
        <p v-if="closeRefused" class="mb-connect-page__text">You can close this tab now.</p>
        <button v-else type="button" class="mb-connect-page__close" @click="close">Close</button>
      </template>
      <p v-else class="mb-connect-page__text">Taking you to {{ plugin.name }} to approve the link…</p>
    </div>
    <div v-else-if="lent" class="mb-connect-page__card">
      <h1 class="mb-connect-page__title">Signing in{{ lentApp ? ` to ${lentApp}` : "" }}</h1>
      <p class="mb-connect-page__text">{{ problem || "Taking you there to approve the link…" }}</p>
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

.mb-connect-page__close {
  margin-top: 8px;
  padding: 8px 20px;
  border: 0;
  border-radius: 18px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  font: inherit;
  font-size: 14px;
  cursor: pointer;
}

.mb-connect-page__text {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 20px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
