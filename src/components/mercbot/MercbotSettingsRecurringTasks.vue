<script setup>
import { computed, onMounted, ref, watch } from "vue";
import { appsApi } from "../apps/appsApi.js";
import { nanoMoney, saidByServer } from "./accountApi.js";
import { botsApi } from "./botsApi.js";
import { chatsApi } from "./chatsApi.js";
import { homeChanges } from "./homesApi.js";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import { FILTERS, KIND_LABELS, costWords, groupsOf, kept, summaryParts, whenWords } from "./recurringTasksView.js";

// Settings → Recurring tasks (D-132): every routine and watch in the chats the person can open and every app's job,
// grouped by bot, each with where it runs, when in words, its last and next run, its state and what it cost in the last
// 30 days. Its switch pauses or resumes it and its menu opens its chat or app, edits a routine through its chat and
// deletes, each by its own kind's rules (`can`). A bot's card opens it filtered to that bot (`bot`).
const props = defineProps({
  bot: { type: String, default: "" }
});
// `open-chat` (a chat's id), `edit-routine` (the routine) and `open-app` (an app's slug) leave Settings for it.
const emit = defineEmits(["failure", "notify", "open-chat", "edit-routine", "open-app"]);

const list = ref(null);
// Why the list couldn't load, in the server's words when it said some; shown in place, with Try again.
const failed = ref("");
const filter = ref("all");
const sort = ref("bot");
const onlyBot = ref(props.bot);
const busy = ref(new Set());
const deleting = ref(null);
const now = ref(new Date());

async function load() {
  failed.value = "";
  try {
    list.value = await botsApi.recurringTasks();
    now.value = new Date();
  } catch (error) {
    failed.value = saidByServer(error, "Try again in a moment.");
    // A list already on screen stays; only then is the failure told apart from it.
    if (list.value) emit("failure", error);
  }
}
onMounted(load);
watch(homeChanges, load);
watch(() => props.bot, (bot) => {
  onlyBot.value = bot;
});

// The top line counts what's shown: one bot's tasks when the list is at one bot, else the whole home's.
const summary = computed(() => {
  if (!list.value) return null;
  if (!onlyBot.value) return summaryParts(list.value);
  return summaryParts({ tasks: list.value.tasks.filter((task) => task.bot?.id === onlyBot.value), others: null, notListedNano: 0 });
});
const groups = computed(() => (list.value ? groupsOf(list.value.tasks, { filter: filter.value, bot: onlyBot.value, sort: sort.value }) : []));
const botName = computed(() => list.value?.tasks.find((task) => task.bot?.id === onlyBot.value)?.bot.name || "this bot");
// A chip for each kind and state the list has, and the one chosen.
const filters = computed(() => FILTERS.filter((entry) =>
  entry.value === "all" || entry.value === filter.value || (list.value?.tasks || []).some((task) => kept(task, entry.value))));

const keyOf = (task) => `${task.kind}:${task.id}`;
const switchable = (task) => (task.state === "paused" || task.state === "failing" ? task.can.resume : task.can.pause);
function switchNote(task) {
  if (switchable(task)) return "";
  if (task.kind === "job") return "Only the home's owners and admins can switch an app's jobs.";
  return "Only the person who set it up can resume it: it runs as them.";
}

function whereText(task) {
  return task.where.appName ? task.where.appName : task.where.chatTitle || "A chat";
}
function whenLine(task) {
  const parts = [task.schedule];
  if (task.nextRunAt && task.state === "running") {
    // A run its runner hasn't picked up yet is due, never "ago".
    const due = new Date(task.nextRunAt) <= now.value;
    parts.push(due ? "Next: due now" : `Next ${whenWords(task.nextRunAt, now.value)}`);
  }
  if (task.lastRunAt) parts.push(`Last ${whenWords(task.lastRunAt, now.value)}`);
  return parts.join(" · ");
}

async function act(task, work, done) {
  const key = keyOf(task);
  busy.value = new Set([...busy.value, key]);
  try {
    await work();
    await load();
    if (done) emit("notify", done);
  } catch (error) {
    emit("failure", error);
  } finally {
    busy.value = new Set([...busy.value].filter((entry) => entry !== key));
  }
}

function toggle(task) {
  const on = task.state !== "running";
  const work = {
    routine: () => chatsApi.switchRoutine(task.id, on),
    watch: () => appsApi.setWatch(task.id, on),
    job: () => appsApi.setScriptEnabled(task.where.appSlug, task.key, on)
  }[task.kind];
  return act(task, work, on ? `Resumed “${task.name}”` : `Paused “${task.name}”`);
}

function remove() {
  const task = deleting.value;
  deleting.value = null;
  const work = task.kind === "routine" ? () => chatsApi.removeRoutine(task.id) : () => appsApi.removeWatch(task.id);
  return act(task, work, `Deleted “${task.name}”`);
}

function open(task) {
  if (task.where.appSlug) emit("open-app", task.where.appSlug);
  else emit("open-chat", task.where.chatId);
}

function menuOf(task) {
  return [
    { title: task.where.appSlug ? "Open app" : "Open chat", icon: task.where.appSlug ? "$apps" : "$chat", run: () => open(task) },
    ...(task.kind === "routine" && task.can.edit
      ? [{ title: "Edit", icon: "$edit", run: () => emit("edit-routine", { id: task.id, name: task.name, chatId: task.where.chatId }) }]
      : []),
    ...(task.can.delete ? [{ title: "Delete", icon: "$delete", danger: true, run: () => (deleting.value = task) }] : [])
  ];
}
</script>

<template>
  <section class="mb-tasks">
    <div v-if="list === null && !failed" class="mb-set-card" aria-busy="true" aria-label="Loading recurring tasks">
      <div v-for="row in 3" :key="row" class="mb-set-row"><span class="mb-tasks__skeleton" /></div>
    </div>

    <div v-else-if="failed && list === null" class="mb-set-card">
      <div class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">The recurring tasks couldn't load.</span>
          <span class="mb-set-row__description">{{ failed }}</span>
        </span>
        <button type="button" class="mb-set-pill" @click="load">Try again</button>
      </div>
    </div>

    <template v-else>
      <p class="mb-tasks__summary" data-testid="recurring-summary">
        <span>{{ summary.parts.join(" · ") }}</span>
        <span class="mb-tasks__spent">{{ summary.spent }} in the last 30 days{{ list.costScope === "own" ? ", on tasks that run as you" : "" }}</span>
      </p>

      <div v-if="list.tasks.length" class="mb-tasks__tools">
        <v-chip-group v-model="filter" mandatory selected-class="mb-tasks__chip--on" aria-label="Show">
          <v-chip v-for="entry in filters" :key="entry.value" :value="entry.value" size="small" variant="outlined" class="mb-tasks__chip">
            {{ entry.label }}
          </v-chip>
        </v-chip-group>
        <v-menu location="bottom end" :offset="4" content-class="mb-popover">
          <template #activator="{ props: sortProps }">
            <button v-bind="sortProps" type="button" class="mb-set-pill" :aria-label="`Sort: ${sort === 'cost' ? 'by cost' : 'by bot'}`">
              {{ sort === "cost" ? "By cost" : "By bot" }} <v-icon icon="$expand" size="14" />
            </button>
          </template>
          <v-list density="compact" class="py-1" width="180">
            <v-list-item min-height="32" class="px-3" @click="sort = 'bot'"><span class="mb-tasks__menu">By bot</span></v-list-item>
            <v-list-item min-height="32" class="px-3" @click="sort = 'cost'"><span class="mb-tasks__menu">By cost</span></v-list-item>
          </v-list>
        </v-menu>
      </div>

      <div v-if="onlyBot" class="mb-tasks__only">
        <v-chip size="small" closable :close-label="`Show every bot's tasks`" @click:close="onlyBot = ''">Only {{ botName }}</v-chip>
      </div>

      <div v-if="!list.tasks.length" class="mb-set-card" data-testid="recurring-empty">
        <div class="mb-set-row mb-tasks__empty">
          <v-icon icon="$clockLoaderHalf" size="20" class="mb-tasks__empty-icon" />
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">No recurring tasks yet</span>
            <span class="mb-set-row__description">Ask a bot in any chat, for example: “Check the weather every morning at 7.”</span>
          </span>
        </div>
      </div>
      <p v-else-if="!groups.length" class="mb-tasks__none">
        Nothing here with this filter.
        <button type="button" class="mb-tasks__where" @click="filter = 'all'; onlyBot = ''">Show every task</button>
      </p>

      <div v-for="group in groups" :key="group.key" class="mb-tasks__group">
        <p class="mb-set-group mb-tasks__group-head">
          <MercbotAvatar v-if="group.bot" :bot="group.bot" :size="18" still />
          <v-icon v-else-if="group.key === 'apps'" icon="$apps" size="16" />
          {{ group.title }}
        </p>
        <ul class="mb-set-card mb-tasks__list">
          <li v-for="task in group.tasks" :key="keyOf(task)" class="mb-set-row mb-tasks__row" :data-task="keyOf(task)">
            <span class="mb-set-row__text">
              <span class="mb-set-row__label mb-tasks__name">
                <span class="mb-tasks__title">{{ task.name }}</span>
                <span class="mb-tasks__kind">{{ KIND_LABELS[task.kind] }}</span>
                <span v-if="task.state === 'paused'" class="mb-tasks__kind">Paused</span>
              </span>
              <span v-if="task.detail" class="mb-set-row__description mb-tasks__detail">{{ task.detail }}</span>
              <span class="mb-set-row__description">
                <button type="button" class="mb-tasks__where" @click="open(task)">
                  <v-icon :icon="task.where.appSlug ? '$apps' : '$chat'" size="13" />{{ whereText(task) }}
                </button>
                <template v-if="sort === 'cost' && task.bot"> · {{ task.bot.name }}</template>
              </span>
              <span class="mb-set-row__description">{{ whenLine(task) }}</span>
              <span v-if="task.why" class="mb-tasks__why"><v-icon icon="$warning" size="13" />{{ task.why }}</span>
            </span>
            <span class="mb-tasks__side">
              <span v-if="costWords(task)" class="mb-tasks__cost" :class="{ 'mb-tasks__cost--none': !task.cost?.nano }">{{ costWords(task) }}</span>
              <span
                v-else
                class="mb-tasks__cost mb-tasks__cost--none"
                title="Only the home's owners and admins, and the person it runs as, see its cost"
                aria-label="Cost not shown: it runs as someone else"
              >—</span>
              <v-tooltip :text="switchNote(task)" :disabled="!switchNote(task)" location="top">
                <template #activator="{ props: tipProps }">
                  <span v-bind="tipProps">
                    <v-switch
                      :model-value="task.state === 'running'"
                      :disabled="!switchable(task) || busy.has(keyOf(task))"
                      color="primary"
                      density="compact"
                      hide-details
                      inset
                      :aria-label="task.state === 'running' ? `Pause ${task.name}` : `Resume ${task.name}`"
                      @update:model-value="toggle(task)"
                    />
                  </span>
                </template>
              </v-tooltip>
              <v-menu location="bottom end" :offset="4" content-class="mb-popover">
                <template #activator="{ props: menuProps }">
                  <v-btn v-bind="menuProps" icon="$moreHoriz" size="28" variant="text" :aria-label="`More for ${task.name}`" />
                </template>
                <v-list density="compact" class="py-1" width="180">
                  <v-list-item v-for="item in menuOf(task)" :key="item.title" min-height="32" class="px-3" @click="item.run()">
                    <span class="mb-tasks__menu" :class="{ 'text-error': item.danger }"><v-icon :icon="item.icon" size="16" />{{ item.title }}</span>
                  </v-list-item>
                </v-list>
              </v-menu>
            </span>
          </li>
        </ul>
      </div>

      <div v-if="list.others || list.notListedNano" class="mb-set-card">
        <div v-if="list.others" class="mb-set-row" data-testid="recurring-others">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">{{ list.others.count }} more {{ list.others.count === 1 ? "task" : "tasks" }} in chats you can't open</span>
            <span class="mb-set-row__description">They run as the people who set them up, in chats only they and the people there can open.</span>
          </span>
          <span class="mb-tasks__cost">{{ nanoMoney(list.others.costNano) }}</span>
        </div>
        <div v-if="list.notListedNano" class="mb-set-row">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">Tasks no longer listed here</span>
            <span class="mb-set-row__description">What tasks since deleted cost in the last 30 days{{ list.costScope === "own" ? ", and yours in chats you've left" : "" }}.</span>
          </span>
          <span class="mb-tasks__cost">{{ nanoMoney(list.notListedNano) }}</span>
        </div>
      </div>

      <p class="mb-set-caption mb-tasks__caption">
        A task's cost is what its runs' AI work cost in the last 30 days, counted since this list began.
        {{ list.costScope === "own" ? "You see the costs of the tasks that run as you; owners and admins see every task's." : "Owners and admins see every task's cost; members see their own." }}
        Apps' jobs run without AI.
      </p>
    </template>

    <MercbotConfirmDialog
      :model-value="Boolean(deleting)"
      :title="`Delete “${deleting?.name || ''}”?`"
      text="It stops for good, in its chat and everywhere."
      @update:model-value="!$event && (deleting = null)"
      @confirm="remove"
    />
  </section>
</template>

<style scoped>
.mb-tasks__summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  gap: 4px 16px;
  max-width: 636px;
  margin: 0 0 12px;
  font-size: 14px;
  line-height: 20px;
}

.mb-tasks__spent {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tasks__tools {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  max-width: 636px;
  margin-bottom: 14px;
}

.mb-tasks__tools :deep(.v-slide-group__content) {
  flex-wrap: wrap;
}

.mb-tasks__chip--on {
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}

.mb-tasks__only {
  margin: -4px 0 14px;
}

.mb-tasks__group-head {
  display: flex;
  align-items: center;
  gap: 8px;
}

.mb-tasks__list {
  padding: 0;
  list-style: none;
}

.mb-tasks__row {
  align-items: flex-start;
  padding-top: 12px;
  padding-bottom: 12px;
}

.mb-tasks__name {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.mb-tasks__title {
  min-width: 0;
  overflow-wrap: anywhere;
}

.mb-tasks__kind {
  padding: 0 7px;
  border-radius: 9px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 11px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tasks__detail {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.mb-tasks__where {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  max-width: 100%;
  padding: 0;
  border: 0;
  background: transparent;
  font: inherit;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
}

.mb-tasks__where:hover {
  text-decoration: underline;
}

.mb-tasks__why {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 2px;
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-error));
}

.mb-tasks__side {
  display: flex;
  flex: none;
  align-items: center;
  gap: 4px;
}

.mb-tasks__cost {
  min-width: 64px;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}

.mb-tasks__cost--none {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tasks__menu {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.mb-tasks__empty-icon,
.mb-tasks__none {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-tasks__none {
  margin: 0 0 26px;
  font-size: 13px;
}

.mb-tasks__caption {
  margin-top: 0;
}

.mb-tasks__skeleton {
  width: 60%;
  height: 14px;
  border-radius: 7px;
  background: rgb(var(--v-theme-surface-container-high));
}

/* On a phone, each row's cost and controls go under its words. */
@media (max-width: 599px) {
  .mb-tasks__row {
    flex-wrap: wrap;
    gap: 8px 16px;
  }

  .mb-tasks__side {
    justify-content: flex-end;
    width: 100%;
  }

  .mb-tasks__cost {
    flex: 1;
    text-align: left;
  }
}
</style>
