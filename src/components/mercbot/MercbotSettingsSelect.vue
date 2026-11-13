<script setup>
import { computed, nextTick, ref, watch } from "vue";

// A settings dropdown: an outlined pill showing the value, opening a list with a tick
// on the current one. Searchable lists (language, timezone) get a field on top. Options are
// { value, label, hint }; the hint shows grey on the right.
const props = defineProps({
  options: { type: Array, required: true },
  label: { type: String, required: true },
  searchable: { type: Boolean, default: false },
  width: { type: Number, default: 240 }
});
const model = defineModel({ type: String, default: "" });
const open = ref(false);
const query = ref("");
const field = ref(null);

const current = computed(() => props.options.find((option) => option.value === model.value) || props.options[0]);
const shown = computed(() => {
  const text = query.value.trim().toLowerCase();
  if (!text) return props.options;
  return props.options.filter((option) => `${option.label} ${option.hint || ""} ${option.value}`.toLowerCase().includes(text));
});

watch(open, (value) => {
  if (value) query.value = "";
});

// Searchable lists take typing at once: the field gets focus once the list has opened.
async function focusSearch() {
  await nextTick();
  field.value?.focus();
}

function choose(option) {
  model.value = option.value;
  open.value = false;
}
</script>

<template>
  <v-menu
    v-model="open"
    location="bottom end"
    :offset="4"
    content-class="mb-popover"
    :close-on-content-click="false"
    @after-enter="focusSearch"
  >
    <template #activator="{ props: activator }">
      <button v-bind="activator" type="button" class="mb-select" :aria-label="label">
        <span class="mb-select__value">{{ current?.label }}</span>
        <v-icon icon="$expand" size="14" />
      </button>
    </template>
    <div class="mb-select__menu" :style="{ width: `${width}px` }">
      <div v-if="searchable" class="mb-select__search">
        <v-icon icon="$search" size="14" />
        <input ref="field" v-model="query" :aria-label="`Search ${label}`" placeholder="Search">
        <button v-if="query" type="button" aria-label="Clear the search" @click="query = ''">
          <v-icon icon="$close" size="12" />
        </button>
      </div>
      <ul class="mb-select__list" role="listbox" :aria-label="label">
        <li
          v-for="option in shown"
          :key="option.value"
          role="option"
          class="mb-select__option"
          :aria-selected="option.value === model"
          @click="choose(option)"
        >
          <v-icon icon="$check" size="14" class="mb-select__tick" :style="{ opacity: option.value === model ? 1 : 0 }" />
          <span class="mb-select__label">{{ option.label }}</span>
          <span v-if="option.hint" class="mb-select__hint">{{ option.hint }}</span>
        </li>
      </ul>
    </div>
  </v-menu>
</template>

<style scoped>
.mb-select {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 260px;
  height: 30px;
  padding: 0 8px 0 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: rgb(var(--v-theme-surface));
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  cursor: pointer;
}

.mb-select__value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-select__menu {
  overflow: hidden;
  border-radius: 12px;
  background: rgb(var(--v-theme-surface));
}

.mb-select__search {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 36px;
  padding: 0 10px;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-select__search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  outline: none;
}

.mb-select__search button {
  display: inline-flex;
  border: 0;
  background: transparent;
  color: inherit;
  cursor: pointer;
}

.mb-select__list {
  max-height: 300px;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  list-style: none;
}

.mb-select__option {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 32px;
  padding: 0 8px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
}

.mb-select__option:hover {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-select__tick {
  flex: none;
}

.mb-select__label {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-select__hint {
  flex: none;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
