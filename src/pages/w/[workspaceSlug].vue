<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "home"
    }
  }
}
</route>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RouterView, useRoute } from "vue-router";
import { useShellAppBar } from "@jskit-ai/shell-web/client/composables/useShellAppBar";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { useShellNavigation } from "@jskit-ai/shell-web/client/navigation/useShellNavigation";
import { isUpKey } from "@/components/mercbot/shortcuts.js";
import { setCurrentHome } from "@/components/mercbot/homeApi.js";
import { useHomes } from "@/components/mercbot/homesApi.js";

// A home (D-36): everything inside talks to this home's API. Changing home remounts the whole
// chat, so every screen reloads with the new home's bots and nothing from the old one lingers.
// A home the person isn't in shows a short card instead of a broken chat.
// Its pages draw their own top bars, with the shell's Up arrow on inner pages (Apps, an app, a table,
// Files), so the home enters JSKIT's navigation trail here, once. Ctrl+[ does what that arrow does (D-64).
useShellAppBar();
const { canGoUp, up } = useShellNavigation();

function onUpKey(event) {
  if (!isUpKey(event) || !canGoUp.value || document.querySelector(".v-overlay--active")) return;
  event.preventDefault();
  void up();
}

onMounted(() => window.addEventListener("keydown", onUpKey));
onBeforeUnmount(() => window.removeEventListener("keydown", onUpKey));
const route = useRoute();
const paths = usePaths();
const { homes, load } = useHomes();
const slug = computed(() => String(route.params.workspaceSlug || "").toLowerCase());
const state = ref("loading");

async function settle(value, fresh = false) {
  // The chat waits until the new home is set, so nothing inside talks to the old one.
  state.value = "loading";
  try {
    const mine = (await load({ fresh })).find((home) => home.slug === value);
    if (!mine) {
      state.value = "missing";
      return;
    }
    setCurrentHome(mine.slug);
    try {
      localStorage.setItem("mercbot.lastHome", mine.slug);
    } catch {
      // Private browsing: the last home just isn't remembered.
    }
    state.value = "ready";
  } catch {
    state.value = "error";
  }
}

watch(slug, (value) => settle(value), { immediate: true });

const others = computed(() => homes.value || []);
</script>

<template>
  <RouterView v-if="state === 'ready'" :key="slug" />
  <main v-else-if="state !== 'loading'" class="mb-home-missing">
    <section class="mb-home-missing__card">
      <template v-if="state === 'missing'">
        <p class="mb-home-missing__title">This home isn't one of yours</p>
        <p class="mb-home-missing__text">Ask someone in it to invite you, or go back to a home you're in.</p>
        <div class="mb-home-missing__homes">
          <RouterLink v-for="home in others" :key="home.id" :to="paths.page('/', { params: { workspaceSlug: home.slug } })" class="mb-home-missing__home">
            <span class="mb-home-missing__badge">{{ home.name.slice(0, 1).toUpperCase() }}</span>
            {{ home.name }}
          </RouterLink>
        </div>
      </template>
      <template v-else>
        <p class="mb-home-missing__title">Mercbot couldn't load your homes</p>
        <button type="button" class="mb-set-pill mb-set-pill--dark" @click="settle(slug, true)">Try again</button>
      </template>
    </section>
  </main>
</template>

<style scoped>
.mb-home-missing {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  background: rgb(var(--v-theme-background));
}

.mb-home-missing__card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  width: 100%;
  max-width: 380px;
  padding: 24px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 18px;
  background: rgb(var(--v-theme-surface));
}

.mb-home-missing__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.mb-home-missing__text {
  margin: 0;
  font-size: 14px;
  line-height: 20px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-home-missing__homes {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-top: 6px;
}

.mb-home-missing__home {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface));
  text-decoration: none;
}

.mb-home-missing__home:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-home-missing__badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: rgb(var(--v-theme-inverse-surface));
  color: rgb(var(--v-theme-inverse-on-surface));
  font-size: 13px;
  font-weight: 600;
}
</style>
