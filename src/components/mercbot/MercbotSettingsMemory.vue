<script setup>
import { onMounted, ref } from "vue";
import { botsApi } from "./botsApi.js";

// Settings → Memory: the lasting facts your bots saved about you, which all of
// them know. Removing one makes every bot forget it. Chats themselves are never shared.
const emit = defineEmits(["failure"]);
const memories = ref(null);

onMounted(async () => {
  try {
    memories.value = (await botsApi.memories()).memories;
  } catch (error) {
    memories.value = [];
    emit("failure", error);
  }
});

async function forget(memory) {
  try {
    await botsApi.forgetMemory(memory.id);
    memories.value = memories.value.filter((entry) => entry.id !== memory.id);
  } catch (error) {
    emit("failure", error);
  }
}
</script>

<template>
  <section v-if="memories">
    <p class="mb-set-group">What your bots remember about you</p>
    <ul v-if="memories.length" class="mb-set-card mb-memory__list">
      <li v-for="memory in memories" :key="memory.id" class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label mb-memory__fact">{{ memory.fact }}</span>
        </span>
        <button type="button" class="mb-memory__remove" :aria-label="`Forget: ${memory.fact}`" @click="forget(memory)">
          <v-icon icon="$close" size="16" />
        </button>
      </li>
    </ul>
    <p v-else class="mb-memory__empty">Nothing yet. When you tell a bot something lasting, like an allergy or a preference, it remembers it here, and all your bots know it.</p>
    <p class="mb-memory__note">Only these facts are shared between your bots. Your chats with each bot stay private.</p>
  </section>
</template>

<style scoped>
.mb-memory__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mb-memory__fact {
  font-weight: 400;
  white-space: normal;
}

.mb-memory__remove {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-memory__remove:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-memory__empty,
.mb-memory__note {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-memory__note {
  margin-top: 12px;
}
</style>
