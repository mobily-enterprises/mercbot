<script setup>
import { onMounted, ref } from "vue";
import { useRoute } from "vue-router";
import iconUrl from "../../../favicon.svg";
import MercbotAvatar from "@/components/mercbot/MercbotAvatar.vue";
import { templatesApi } from "./templatesApi.js";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";

// A template's share page, at its short link: what someone opening a shared bot sees.
// Adding happens in Mercbot, which first shows everything the bot would be given (D-43).
const paths = usePaths();
const route = useRoute();
const template = ref(null);
const failed = ref("");

onMounted(async () => {
  try {
    template.value = await templatesApi.template(String(route.params.slug || ""));
  } catch (error) {
    failed.value = error?.status === 404 ? "There's no bot at this link. It may have been removed." : "This bot couldn't be loaded. Try again in a moment.";
  }
});
const team = () => Boolean(template.value?.team);
</script>

<template>
  <div class="mb-share">
    <router-link :to="paths.page('/', { surface: 'start' })" class="mb-share__brand"><img :src="iconUrl" alt="" width="36" height="36"> Mercbot</router-link>
    <p v-if="failed" class="mb-share__note">{{ failed }}</p>
    <p v-else-if="!template" class="mb-share__note">Loading…</p>
    <section v-else class="mb-share__card">
      <div class="mb-share__cover" :style="{ background: `linear-gradient(160deg, ${template.color}33, ${template.color}0d)` }">
        <MercbotAvatar :bot="{ id: `template-${template.slug}`, name: template.name, color: template.color, shape: template.shape }" :size="96" still />
      </div>
      <div class="mb-share__body">
        <h1 class="mb-share__name">{{ template.name }}</h1>
        <p class="mb-share__description">{{ template.description }}</p>
        <p class="mb-share__fine">
          <template v-if="team()">Made by the Mercbot team.</template>
          <template v-else>Made by {{ template.creator }}, not by Mercbot.</template>
          Once added, it may act on your behalf with the apps you connect, and it always asks before sending anything. You'll see everything it's told to do before you add it. Adding it follows Mercbot's terms of use.
        </p>
        <router-link class="mb-share__add" :to="{ path: paths.page('/', { surface: 'start' }), query: { template: template.slug } }">Add to Mercbot</router-link>
      </div>
    </section>
    <p class="mb-share__new">New to Mercbot? <router-link :to="paths.page('/login', { surface: 'auth' })">Create an account</router-link>, then come back to this link.</p>
  </div>
</template>

<style scoped>
.mb-share {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-height: 100vh;
  padding: 40px 20px;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-surface));
}

.mb-share__brand {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 28px;
  color: inherit;
  font-size: 18px;
  font-weight: 600;
  text-decoration: none;
}

.mb-share__brand img {
  border-radius: 10px;
}

.mb-share__card {
  width: min(420px, 100%);
  overflow: hidden;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 20px;
  background: rgb(var(--v-theme-surface));
}

.mb-share__cover {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 180px;
}

.mb-share__body {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px 24px 24px;
  text-align: center;
}

.mb-share__name {
  margin: 0;
  font-size: 22px;
  font-weight: 700;
}

.mb-share__description {
  margin: 8px 0 14px;
  font-size: 15px;
  line-height: 22px;
}

.mb-share__fine {
  margin: 0 0 18px;
  font-size: 12px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-share__add {
  width: 100%;
  padding: 12px 0;
  border-radius: 22px;
  background: rgb(var(--v-theme-on-surface));
  color: rgb(var(--v-theme-surface));
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
}

.mb-share__new,
.mb-share__note {
  margin-top: 18px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-share__new a {
  color: inherit;
}
</style>
