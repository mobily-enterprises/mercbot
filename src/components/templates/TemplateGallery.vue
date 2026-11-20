<script setup>
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import iconUrl from "../../../favicon.svg";
import TemplateBrowser from "./TemplateBrowser.vue";

// The bot template gallery's page (D-43): public, curated by the Mercbot team. The browsing itself, chips, search,
// featured cards and a section per job area with every template's honest badge (D-79), is TemplateBrowser.vue, which
// New bot's From a template shows too.
const paths = usePaths();
</script>

<template>
  <div class="mb-gallery">
    <header class="mb-gallery__bar">
      <router-link :to="paths.page('/', { surface: 'start' })" class="mb-gallery__brand"><img :src="iconUrl" alt="" width="28" height="28"> Mercbot</router-link>
    </header>
    <main class="mb-gallery__main">
      <h1 class="mb-gallery__title">Bot templates</h1>
      <p class="mb-gallery__lead">Ready-made bots for one job each. Every one starts by asking about you, and asks before it sends anything.</p>

      <TemplateBrowser />
    </main>
  </div>
</template>

<style scoped>
.mb-gallery {
  min-height: 100vh;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-surface));
}

.mb-gallery__bar {
  display: flex;
  align-items: center;
  height: 56px;
  padding: 0 24px;
}

.mb-gallery__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}

.mb-gallery__brand img {
  border-radius: 8px;
}

.mb-gallery__main {
  max-width: 980px;
  margin: 0 auto;
  padding: 24px 24px 80px;
}

.mb-gallery__title {
  margin: 0;
  font-size: 34px;
  line-height: 42px;
  font-weight: 700;
}

.mb-gallery__lead {
  margin: 8px 0 20px;
  font-size: 15px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
