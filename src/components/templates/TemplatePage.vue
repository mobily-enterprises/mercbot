<script setup>
import { onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useAuthStore } from "@jskit-ai/auth-web/client";
import ShellUpButton from "@jskit-ai/shell-web/client/components/ShellUpButton";
import { useShellAppBar } from "@jskit-ai/shell-web/client/composables/useShellAppBar";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import iconUrl from "../../../favicon.svg";
import extensions from "../mercbot/extensions.js";
import TemplateAvatar from "./TemplateAvatar.vue";
import TemplateContents from "./TemplateContents.vue";
import TemplateTested from "./TemplateTested.vue";
import { templatesApi } from "./templatesApi.js";

// A template's page: who made it, what it's for, and everything it would give a bot. Its bar
// has the shell's Up arrow, to the gallery or wherever the person came from. Under a team template's badge, someone
// signed in also sees the parts a copy built on Mercbot adds there (extensions.js) that are for them.
useShellAppBar();
const route = useRoute();
const paths = usePaths();
const auth = useAuthStore();
const template = ref(null);
const failed = ref("");
const parts = ref([]);

// Asked only once someone signed in reads one of the team's templates: whether each added part is for them.
watch(() => template.value?.team && auth.authenticated && template.value.slug, async (slug) => {
  if (!slug) return;
  const answers = await Promise.all(extensions.templateParts.map((part) => (part.visible ? part.visible().catch(() => false) : true)));
  parts.value = extensions.templateParts.filter((_part, at) => answers[at]);
});

onMounted(async () => {
  try {
    template.value = await templatesApi.template(String(route.params.slug || ""));
  } catch (error) {
    failed.value = error?.status === 404 ? "There's no bot template here." : "This template couldn't be loaded. Try again in a moment.";
  }
});
</script>

<template>
  <div class="mb-tpage">
    <header class="mb-tpage__bar">
      <ShellUpButton />
      <router-link :to="paths.page('/', { surface: 'start' })" class="mb-tpage__brand"><img :src="iconUrl" alt="" width="28" height="28"> Mercbot</router-link>
    </header>
    <main class="mb-tpage__main">
      <p v-if="failed" class="mb-tpage__note">{{ failed }}</p>
      <p v-else-if="!template" class="mb-tpage__note">Loading…</p>
      <template v-else>
        <section class="mb-tpage__head">
          <TemplateAvatar :template="template" :size="96" />
          <h1 class="mb-tpage__name">{{ template.name }}</h1>
          <p class="mb-tpage__by">
            by {{ template.creator }}
            <v-icon v-if="template.team" icon="$verified" size="16" class="mb-tpage__verified" aria-label="Made by Mercbot" />
          </p>
          <p class="mb-tpage__description">{{ template.description }}</p>
          <router-link class="mb-tpage__add" :to="paths.page(`/${encodeURIComponent(template.slug)}`, { surface: 'share' })">Add to Mercbot</router-link>
          <!-- Only the Mercbot team's templates are checked end to end (D-43, D-79). -->
          <p v-if="template.team" class="mb-tpage__tested"><TemplateTested :template="template" /></p>
          <component :is="part.component" v-for="(part, at) in parts" :key="at" :template="template" />
        </section>
        <TemplateContents :template="template" />
      </template>
    </main>
  </div>
</template>

<style scoped>
.mb-tpage {
  min-height: 100vh;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-surface));
}

.mb-tpage__bar {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 56px;
  padding: 0 24px;
}

.mb-tpage__brand {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: inherit;
  font-size: 15px;
  font-weight: 600;
  text-decoration: none;
}

.mb-tpage__brand img {
  border-radius: 8px;
}

.mb-tpage__main {
  max-width: 860px;
  margin: 0 auto;
  padding: 16px 24px 80px;
}

.mb-tpage__head {
  display: flex;
  flex-direction: column;
  align-items: center;
  margin: 24px 0 32px;
  text-align: center;
}

.mb-tpage__name {
  margin: 16px 0 2px;
  font-size: 28px;
  font-weight: 700;
}

.mb-tpage__by {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tpage__verified {
  color: rgb(var(--v-theme-link));
}

.mb-tpage__description {
  max-width: 520px;
  margin: 12px 0 20px;
  font-size: 15px;
  line-height: 23px;
}

.mb-tpage__add {
  padding: 11px 24px;
  border-radius: 22px;
  background: rgb(var(--v-theme-on-surface));
  color: rgb(var(--v-theme-surface));
  font-size: 15px;
  font-weight: 500;
  text-decoration: none;
}

.mb-tpage__tested {
  margin: 12px 0 0;
}

.mb-tpage__note {
  margin: 12px 0 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
