<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { pluginsApi } from "./pluginsApi.js";

// The repository a bot's GitHub card asks to use (D-128), inside its question card: the one the bot proposed, or
// another of the person's own that Mercbot's GitHub App reaches, found by its name on the server a page at a time. Only the
// person the card is for, while it's open, can choose another (`open`).
const props = defineProps({
  // The bot's: { fullName, private, write }.
  proposed: { type: Object, required: true },
  // Another the person chose on the card, or null.
  picked: { type: Object, default: null },
  open: { type: Boolean, default: false }
});
const emit = defineEmits(["pick"]);

const shown = computed(() => props.picked || props.proposed);
const searching = ref(false);
const words = ref("");
const found = ref([]);
const next = ref(null);
const installUrl = ref("");
const loading = ref(false);
const problem = ref("");
let asked = 0;
let timer = null;

/** A page of their repositories whose name holds the words; `more` goes on from the last page. */
async function look({ more = false } = {}) {
  const ask = ++asked;
  loading.value = true;
  problem.value = "";
  try {
    const page = await pluginsApi.githubRepositories(words.value.trim(), more ? next.value : null);
    if (ask !== asked) return;
    found.value = more ? [...found.value, ...page.repositories] : page.repositories;
    next.value = page.next;
    installUrl.value = page.installUrl || "";
  } catch (error) {
    if (ask === asked) problem.value = error?.message || "Your repositories couldn't be loaded. Try again.";
  } finally {
    if (ask === asked) loading.value = false;
  }
}

watch(words, () => {
  clearTimeout(timer);
  timer = setTimeout(() => look(), 250);
});
onBeforeUnmount(() => clearTimeout(timer));

function startSearch() {
  searching.value = true;
  look();
}

function choose(repository) {
  emit("pick", repository.fullName === props.proposed.fullName ? null : repository);
  searching.value = false;
}

const access = (repository) => `${repository.private ? "Private" : "Public"} · ${repository.write ? "can push" : "read only"}`;
</script>

<template>
  <div class="mb-github-pick">
    <p class="mb-github-pick__repo">
      <span class="mb-github-pick__name">{{ shown.fullName }}</span>
      <span class="mb-github-pick__access mb-text-12">{{ access(shown) }}</span>
    </p>
    <template v-if="open">
      <button v-if="!searching" type="button" class="mb-github-pick__link" @click="startSearch">Choose another repository</button>
      <div v-else class="mb-github-pick__search">
        <input
          v-model="words"
          class="mb-github-pick__input"
          type="search"
          placeholder="Search your repositories"
          aria-label="Search your repositories"
          autocomplete="off"
          spellcheck="false"
        >
        <p v-if="problem" class="mb-github-pick__note" role="alert">{{ problem }}</p>
        <ul v-if="found.length" class="mb-github-pick__list" aria-label="Your repositories">
          <li v-for="repository in found" :key="repository.id">
            <button type="button" class="mb-github-pick__choice" @click="choose(repository)">
              <span class="mb-github-pick__name">{{ repository.fullName }}</span>
              <span class="mb-github-pick__access mb-text-12">{{ access(repository) }}</span>
            </button>
          </li>
        </ul>
        <p v-else-if="loading" class="mb-github-pick__note">Looking…</p>
        <p v-else-if="!problem && !next" class="mb-github-pick__note">
          None of yours matches.
          <a v-if="installUrl" :href="installUrl" target="_blank" rel="noopener">Choose the repositories Mercbot's GitHub App reaches, on GitHub</a>
        </p>
        <div class="mb-github-pick__actions">
          <button v-if="next" type="button" class="mb-github-pick__link" :disabled="loading" @click="look({ more: true })">More</button>
          <button type="button" class="mb-github-pick__link" @click="searching = false">Keep {{ shown.fullName }}</button>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.mb-github-pick {
  margin: 4px 0 8px;
}
.mb-github-pick__repo {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 4px 8px;
  margin: 0;
}
.mb-github-pick__name {
  font-family: ui-monospace, monospace;
  font-size: 13px;
  overflow-wrap: anywhere;
}
.mb-github-pick__access {
  color: rgb(var(--v-theme-on-surface-variant));
}
.mb-github-pick__link {
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: rgb(var(--v-theme-primary));
  font: inherit;
  font-size: 13px;
  font-weight: 400;
  cursor: pointer;
}
.mb-github-pick__link:disabled {
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: default;
}
.mb-github-pick__search {
  margin-top: 6px;
}
.mb-github-pick__input {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
  font: inherit;
}
.mb-github-pick__list {
  max-height: 220px;
  margin: 6px 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}
.mb-github-pick__choice {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 2px 8px;
  width: 100%;
  padding: 6px 4px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.mb-github-pick__choice:hover,
.mb-github-pick__choice:focus-visible {
  background: rgb(var(--v-theme-surface-container-high));
}
.mb-github-pick__note {
  margin: 6px 0 0;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}
.mb-github-pick__actions {
  display: flex;
  gap: 16px;
}
</style>
