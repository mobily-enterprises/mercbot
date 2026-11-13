<script setup>
import { computed, ref } from "vue";

// A bot's to-do list for a job of several steps (D-48): one card, updated in place as it ticks
// items off. A finished list folds to one line, which opens again on a click.
const props = defineProps({
  message: { type: Object, required: true }
});

const items = computed(() => props.message.body.items || []);
const done = computed(() => items.value.filter((item) => item.status === "done").length);
const finished = computed(() => items.value.length > 0 && done.value === items.value.length);
const opened = ref(false);
const shown = computed(() => !finished.value || opened.value);
const ICON = { todo: "$circle", doing: "$clockLoaderHalf", done: "$checkCircleFilled" };
const LABEL = { todo: "To do", doing: "Doing now", done: "Done" };
</script>

<template>
  <section class="mb-todos" :class="{ 'mb-todos--finished': finished }" aria-label="To-do list">
    <button v-if="finished" type="button" class="mb-todos__head mb-todos__head--fold" :aria-expanded="opened" @click="opened = !opened">
      <v-icon icon="$checkCircleFilled" size="18" class="mb-todos__icon--done" />
      <span class="mb-todos__title">Done: {{ done }} of {{ items.length }}</span>
      <v-icon icon="$expand" size="18" class="mb-todos__chevron" :class="{ 'mb-todos__chevron--open': opened }" />
    </button>
    <div v-else class="mb-todos__head">
      <span class="mb-todos__title">To-do</span>
      <span class="mb-todos__count">{{ done }} of {{ items.length }} done</span>
    </div>
    <ol v-if="shown" class="mb-todos__list">
      <li v-for="(item, index) in items" :key="index" class="mb-todos__item" :class="`mb-todos__item--${item.status}`">
        <v-icon :icon="ICON[item.status]" size="16" class="mb-todos__mark" :class="`mb-todos__icon--${item.status}`" :aria-label="LABEL[item.status]" />
        <span class="mb-todos__text">{{ item.text }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.mb-todos {
  max-width: 486px;
  padding: 12px 14px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  color: rgb(var(--v-theme-on-surface));
}

.mb-todos--finished {
  padding-block: 8px;
}

.mb-todos__head {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
}

.mb-todos__head--fold {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}

.mb-todos__title {
  flex: 1;
  min-width: 0;
  font-size: 14px;
  font-weight: 600;
}

.mb-todos__count {
  flex: none;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-todos__chevron {
  color: rgb(var(--v-theme-on-surface-variant));
  transition: transform 0.15s ease;
}

.mb-todos__chevron--open {
  transform: rotate(180deg);
}

.mb-todos__list {
  margin: 8px 0 0;
  padding: 0;
  list-style: none;
}

.mb-todos__item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 3px 0;
  font-size: 14px;
  line-height: 20px;
}

.mb-todos__mark {
  flex: none;
  margin-top: 2px;
}

.mb-todos__text {
  min-width: 0;
  overflow-wrap: anywhere;
}

.mb-todos__item--doing .mb-todos__text {
  font-weight: 600;
}

.mb-todos__item--done .mb-todos__text {
  color: rgb(var(--v-theme-on-surface-variant));
  text-decoration: line-through;
}

.mb-todos__icon--todo {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-todos__icon--doing {
  color: rgb(var(--v-theme-info));
}

.mb-todos__icon--done {
  color: rgb(var(--v-theme-success));
}

.mb-todos__head--fold:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
</style>
