<script setup>
import { onMounted, ref } from "vue";
import { appsApi } from "./appsApi.js";

// The Apps section of a bot's Details (D-35): the bot's watches, which anyone who can open their chat can pause or
// remove, and only whoever set one up resumes (`canResume`: it runs as them). Shown only when it has some. Which bot
// builds the home's apps is chosen in Settings → Main bot and Builder (D-119); the card shows a Builder chip.
const props = defineProps({ bot: { type: Object, required: true } });
const watches = ref([]);
const WHEN = { create: "new records", update: "changes", any: "new records and changes" };

onMounted(async () => {
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
</script>

<template>
  <template v-if="watches.length">
    <p class="mb-details__section">Watches</p>
    <div v-for="watch in watches" :key="watch.id" class="mb-watch" :data-watch="watch.name">
      <div class="mb-watch__text">
        <div class="text-body-2">{{ watch.name }}</div>
        <div class="text-caption text-medium-emphasis">{{ WHEN[watch.on] }} in {{ watch.table }}{{ watch.condition ? ` when ${watch.condition.slice(1)}` : "" }}</div>
      </div>
      <v-switch
        :model-value="watch.enabled"
        :disabled="!watch.enabled && !watch.canResume"
        color="primary"
        density="compact"
        inset
        hide-details
        :aria-label="`${watch.enabled ? 'Pause' : 'Resume'} ${watch.name}`"
        @update:model-value="toggle(watch)"
      />
      <v-btn variant="text" size="small" color="error" @click="remove(watch)">Remove</v-btn>
    </div>
  </template>
</template>

<style scoped>
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
</style>
