<script setup>
import { builderBotId } from "@/components/mercbot/builderBot.js";
import { computed, onMounted, ref } from "vue";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { appsApi } from "./appsApi.js";

// The Apps section of a bot's Details (D-35): the Builder role (one bot of the home builds its
// apps; moving the role leaves every app and table in place), and the bot's watches, which people
// can pause, resume or remove.
const props = defineProps({ bot: { type: Object, required: true } });
const paths = usePaths();
const builder = ref(undefined);
const saving = ref(false);
const canManage = ref(false);
const isBuilder = computed(() => builder.value && String(builder.value.id) === String(props.bot.id));
const watches = ref([]);
const WHEN = { create: "new records", update: "changes", any: "new records and changes" };

onMounted(async () => {
  ({ builder: builder.value, canManage: canManage.value = false } = await appsApi.builder().catch(() => ({ builder: null })));
  watches.value = (await appsApi.watches(props.bot.id).catch(() => ({ watches: [] }))).watches;
});

async function toggle(watch) {
  const { enabled } = await appsApi.setWatch(watch.id, !watch.enabled);
  watch.enabled = enabled;
}

async function remove(watch) {
  await appsApi.removeWatch(watch.id);
  watches.value = watches.value.filter((entry) => entry.id !== watch.id);
}

async function makeBuilder() {
  saving.value = true;
  try {
    builder.value = (await appsApi.setBuilder(props.bot.id)).builder;
    builderBotId.value = builder.value?.id ?? null;
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <template v-if="builder !== undefined">
    <p class="mb-details__section">Apps</p>
    <div class="mb-builder">
      <template v-if="isBuilder">
        <span class="mb-builder__text">{{ bot.name }} is this home's Builder: it makes and changes the apps.</span>
        <v-btn :to="paths.page('/apps')" variant="text" size="small">Open Apps</v-btn>
      </template>
      <template v-else>
        <span class="mb-builder__text">{{ builder ? `${builder.name} builds this home's apps.` : "No bot builds this home's apps yet." }}</span>
        <v-btn v-if="canManage" variant="tonal" size="small" :disabled="saving" @click="makeBuilder">{{ saving ? "Saving…" : "Make this the Builder" }}</v-btn>
      </template>
    </div>
    <div v-for="watch in watches" :key="watch.id" class="mb-watch" :data-watch="watch.name">
      <div class="mb-watch__text">
        <div class="text-body-2">{{ watch.name }}</div>
        <div class="text-caption text-medium-emphasis">Watches {{ WHEN[watch.on] }} in {{ watch.table }}{{ watch.condition ? ` when ${watch.condition.slice(1)}` : "" }}</div>
      </div>
      <v-switch :model-value="watch.enabled" color="primary" density="compact" inset hide-details :aria-label="`${watch.enabled ? 'Pause' : 'Resume'} ${watch.name}`" @update:model-value="toggle(watch)" />
      <v-btn variant="text" size="small" color="error" @click="remove(watch)">Remove</v-btn>
    </div>
  </template>
</template>

<style scoped>
.mb-builder {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 8px;
}
.mb-watch {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}
.mb-watch__text {
  flex: 1 1 auto;
  min-width: 0;
}
.mb-builder__text {
  font-size: 13px;
  flex: 1 1 200px;
}
</style>
