<route lang="json">
{
  "meta": {
    "guard": {
      "policy": "public"
    },
    "jskit": {
      "surface": "start"
    }
  }
}
</route>

<script setup>
import { onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useHomes } from "@/components/mercbot/homesApi.js";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

// Mercbot's main address: the person goes to the home they used last, or their first one (D-36). Nobody reaches it
// signed out: the copy's key opens it, and signs the person in (D-81). A copy built on Mercbot that has people sign in
// replaces this page with its own.
const paths = usePaths();
const router = useRouter();
const route = useRoute();
const { load } = useHomes();
const state = ref("loading");

function lastHome() {
  try {
    return localStorage.getItem("mercbot.lastHome") || "";
  } catch {
    return "";
  }
}

async function open() {
  state.value = "loading";
  try {
    const homes = await load({ fresh: true });
    const target = homes.find((home) => home.slug === lastHome()) || homes[0];
    // A shared bot's link (?template=) carries on into the home, where its preview opens.
    if (target) router.replace({ path: paths.page("/", { surface: "home", params: { workspaceSlug: target.slug } }), query: route.query });
    else state.value = "none";
  } catch {
    state.value = "error";
  }
}

onMounted(open);
</script>

<template>
  <main v-if="state !== 'loading'" class="mb-landing">
    <section class="mb-landing__card">
      <template v-if="state === 'none'">
        <p class="mb-landing__title">You're not in any home yet</p>
      </template>
      <template v-else>
        <p class="mb-landing__title">Mercbot couldn't load your homes</p>
        <button type="button" class="mb-set-pill mb-set-pill--dark" @click="open">Try again</button>
      </template>
    </section>
  </main>
</template>
<style scoped>
.mb-landing {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 24px;
  background: rgb(var(--v-theme-background));
}

.mb-landing__card {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  max-width: 380px;
  padding: 24px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 18px;
  background: rgb(var(--v-theme-surface));
}

.mb-landing__title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}
</style>
