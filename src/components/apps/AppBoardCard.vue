<script setup>
import { ref } from "vue";

// One card of a board, calendar or timeline (D-140): its title and subtitle, its click, dragging, and a menu that moves
// it without dragging: to one of `choices` (a board's columns), or to a day (`day`: a calendar's or timeline's). A
// `bar` (a timeline's) shows no words, which its lane's label shows: only its colour and its menu.
const props = defineProps({
  title: { type: String, required: true },
  subtitle: { type: String, default: "" },
  clickable: { type: Boolean, default: false },
  movable: { type: Boolean, default: false },
  choices: { type: Array, default: null },
  day: { type: String, default: "" },
  dense: { type: Boolean, default: false },
  bar: { type: Boolean, default: false }
});
const emit = defineEmits(["open", "move", "drag"]);
const menu = ref(false);
const chosenDay = ref("");
function openMenu(open) {
  menu.value = open;
  if (open) chosenDay.value = props.day;
}
function moveTo(to) {
  menu.value = false;
  emit("move", to);
}
</script>

<template>
  <v-card
    variant="flat"
    :color="bar ? 'primary-container' : 'surface'"
    rounded="lg"
    class="app-card d-flex align-start"
    :class="{ 'app-card--dense': dense || bar, 'app-card--bar': bar, 'app-clickable': clickable }"
    :aria-label="bar ? title : undefined"
    :draggable="movable"
    :tabindex="clickable ? 0 : undefined"
    :role="clickable ? 'button' : undefined"
    data-testid="app-card"
    @click="clickable && emit('open')"
    @keydown.enter="clickable && emit('open')"
    @dragstart="emit('drag')"
  >
    <div class="flex-grow-1 app-card__words">
      <template v-if="!bar">
        <div class="text-body-medium app-card__title" :title="dense ? title : undefined">{{ title }}</div>
        <div v-if="subtitle && !dense" class="text-body-small text-on-surface-variant">{{ subtitle }}</div>
      </template>
    </div>
    <v-menu content-class="mb-popover" v-if="movable" :model-value="menu" :close-on-content-click="false" @update:model-value="openMenu">
      <template #activator="{ props: menuProps }">
        <v-btn v-bind="menuProps" icon="$moreVert" variant="text" size="x-small" :aria-label="`Move ${title}`" @click.stop />
      </template>
      <v-list v-if="choices" density="compact" :aria-label="`Move ${title} to`">
        <v-list-subheader>Move to</v-list-subheader>
        <v-list-item v-for="choice in choices" :key="choice.value" :title="choice.label" @click="moveTo(choice.value)" />
      </v-list>
      <v-card v-else class="pa-3" min-width="240">
        <v-text-field v-model="chosenDay" type="date" label="Move to" variant="outlined" density="compact" hide-details class="mb-2" />
        <v-btn color="primary" variant="flat" block :disabled="!chosenDay || chosenDay === day" @click="moveTo(chosenDay)">Move</v-btn>
      </v-card>
    </v-menu>
  </v-card>
</template>

<style scoped>
.app-card {
  padding: 8px 4px 8px 12px;
}
.app-card--dense {
  padding: 2px 2px 2px 8px;
}
.app-card[draggable="true"] {
  cursor: grab;
}
.app-card__words {
  min-width: 0;
}
.app-card__title {
  overflow-wrap: anywhere;
}
.app-card--dense .app-card__title {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.app-card--bar {
  min-height: 28px;
  justify-content: flex-end;
}
.app-clickable {
  cursor: pointer;
}
.app-card:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}
</style>
