<script setup>
import { ref, watch } from "vue";
import { botsApi } from "./botsApi.js";
import { madeLine } from "./useRoomsMemory.js";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotIconButton from "./MercbotIconButton.vue";

// The GitHub repositories the person let a bot use in its commands (D-128), on its card's Details: their own yeses on
// its cards, always or for one task in one chat, each with Remove. Nobody sees another person's. Read while Details is
// open; shown only when there is one.
const props = defineProps({
  bot: { type: Object, required: true },
  tab: { type: String, required: true }
});
const emit = defineEmits(["failure"]);

const repositories = ref([]);
const removing = ref(null);
const removeOpen = ref(false);
let shownFor = null;

async function load() {
  const botId = props.bot.id;
  try {
    const listed = await botsApi.githubRepos(botId);
    if (props.bot.id === botId) repositories.value = listed?.repositories || [];
  } catch (error) {
    emit("failure", error);
  }
}

watch([() => props.bot.id, () => props.tab], () => {
  if (props.bot.id !== shownFor) repositories.value = [];
  shownFor = props.bot.id;
  if (props.tab === "details") load();
}, { immediate: true });

function askRemove(repository) {
  removing.value = repository;
  removeOpen.value = true;
}

async function confirmRemove() {
  const repository = removing.value;
  if (!repository) return;
  try {
    const left = await botsApi.removeGithubRepo(props.bot.id, repository.id);
    repositories.value = left?.repositories || [];
  } catch (error) {
    emit("failure", error);
  }
}

const whenLine = (repository) => (repository.chatBotId ? `For one task, until ${madeLine(repository.expiresAt)}` : "Always");
</script>

<template>
  <section v-if="repositories.length" class="mb-github-repos" aria-labelledby="mb-github-repos-title">
    <p id="mb-github-repos-title" class="mb-github-repos__label">GitHub repositories</p>
    <p class="mb-github-repos__sentence">{{ bot.name }} may use these in its commands, as you allowed on its cards.</p>
    <ul class="mb-github-repos__list">
      <li v-for="repository in repositories" :key="repository.id" class="mb-github-repos__row">
        <span class="mb-github-repos__text">
          <span class="mb-github-repos__name">{{ repository.fullName }}</span>
          <span class="mb-github-repos__when">{{ whenLine(repository) }}</span>
        </span>
        <MercbotIconButton icon="$delete" :label="`Remove ${repository.fullName}`" size="x-small" :icon-size="16" @click="askRemove(repository)" />
      </li>
    </ul>
    <MercbotConfirmDialog
      v-model="removeOpen"
      :title="`Remove ${removing?.fullName || ''}?`"
      :text="`${bot.name} will ask you again before its commands use it.`"
      confirm-label="Remove"
      @confirm="confirmRemove"
    />
  </section>
</template>

<style scoped>
.mb-github-repos {
  margin-bottom: 22px;
}
.mb-github-repos__label {
  margin: 0 0 8px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}
.mb-github-repos__sentence {
  margin: 0 0 10px;
  font-size: 14px;
  line-height: 22px;
}
.mb-github-repos__list {
  margin: 0;
  padding: 0;
  list-style: none;
}
.mb-github-repos__row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 0;
}
.mb-github-repos__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}
.mb-github-repos__name {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.mb-github-repos__when {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
