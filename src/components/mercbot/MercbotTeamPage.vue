<script setup>
import { computed, onMounted, shallowRef } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotTemplateTag from "./MercbotTemplateTag.vue";
import { leftLine } from "./archiveBot.js";
import extensions from "./extensions.js";

// Team (D3, plan 4.2): the home's members, people and bots alike, in the main area. Each person with their face, name
// and role; then each bot with its face, name, template, who made it and what it does; then the bots that have left,
// under Archived, with Resume for whoever may. [Message] opens the chat with a member; tapping a row opens their card in
// Details. Add bots, and what a copy built on Mercbot adds beside it (extensions.js teamActions, such as a copy's
// Invite a person), sit at the top. Loading shows the rows' shapes; a failed read says so, with Try again.
const props = defineProps({
  // The team's bots and people, null while they load.
  bots: { type: Array, default: null },
  people: { type: Array, default: null },
  failed: { type: Boolean, default: false },
  // The person looking.
  me: { type: String, default: "" },
  homeName: { type: String, default: "" },
  // Whether the person is one of the home's owners or admins.
  manages: { type: Boolean, default: false },
  // The member whose card is open: "bot:<id>", "person:<id>" or "".
  selected: { type: String, default: "" }
});
const emit = defineEmits(["open-member", "message-bot", "message-person", "add-bots", "unarchive-bot", "retry"]);

const loading = computed(() => !props.failed && (props.bots === null || props.people === null));
const people = computed(() => props.people || []);
const activeBots = computed(() => (props.bots || []).filter((bot) => !bot.archivedAt));
const archivedBots = computed(() => (props.bots || []).filter((bot) => bot.archivedAt));
const listed = computed(() => !loading.value && (people.value.length > 0 || (props.bots || []).length > 0));
// A home of just the person, with no bot to talk to yet.
const justYou = computed(() => listed.value && !activeBots.value.length && people.value.every((person) => person.id === props.me));

const isMe = (person) => Boolean(props.me) && person.id === props.me;
const initialsOf = (name) => String(name || "?").split(/\s+/u).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

/** A bot's line under its name: who made it, when anyone did. */
function madeLine(bot) {
  if (bot.madeBy && String(bot.madeBy) === String(props.me)) return "Bot · made by you";
  return bot.madeByName ? `Bot · made by ${bot.madeByName}` : "Bot";
}

// What a copy built on Mercbot adds beside Add bots: those for everyone at once, the others once their `visible` says yes.
const actions = shallowRef(extensions.teamActions.filter((action) => !action.visible));
onMounted(async () => {
  const answers = await Promise.all(extensions.teamActions.map((action) => (action.visible ? action.visible().catch(() => false) : true)));
  actions.value = extensions.teamActions.filter((_action, at) => answers[at]);
});
</script>

<template>
  <section class="mb-team-page" aria-labelledby="mb-team-page-title">
    <div class="mb-team-page__bar">
      <h1 id="mb-team-page-title" class="mb-team-page__title">Team<span v-if="homeName" class="mb-team-page__home"> · {{ homeName }}</span></h1>
      <div class="mb-team-page__actions">
        <component :is="action.component" v-for="(action, at) in actions" :key="at" :home-name="homeName" />
        <button type="button" class="mb-set-pill mb-set-pill--dark mb-team-page__add" @click="emit('add-bots')">
          <v-icon icon="$add" size="16" /> Add bots
        </button>
      </div>
    </div>

    <p v-if="failed" class="mb-team-page__failed" role="alert">
      Your team didn't load.
      <button type="button" class="mb-team-page__retry" @click="emit('retry')">Try again</button>
    </p>

    <ul v-if="loading" class="mb-team-page__list" aria-label="Loading your team" aria-busy="true">
      <li v-for="row in 4" :key="row" class="mb-team-row mb-team-row--skeleton" aria-hidden="true">
        <span class="mb-team-row__face mb-team-row__face--skeleton" />
        <span class="mb-team-row__text">
          <span class="mb-team-row__bar" />
          <span class="mb-team-row__bar mb-team-row__bar--short" />
        </span>
      </li>
    </ul>

    <template v-else-if="listed">
      <ul class="mb-team-page__list" aria-label="Members">
        <li
          v-for="person in people"
          :key="`person:${person.id}`"
          class="mb-team-row"
          :class="{ 'mb-team-row--selected': selected === `person:${person.id}` }"
          data-member="person"
        >
          <button
            type="button"
            class="mb-team-row__open"
            :aria-label="`${person.name}${isMe(person) ? ' (you)' : ''}, ${person.roleLabel}`"
            :aria-current="selected === `person:${person.id}` ? 'true' : undefined"
            @click="emit('open-member', `person:${person.id}`)"
          >
            <span class="mb-team-row__face mb-team-row__initials" aria-hidden="true">{{ initialsOf(person.name) }}</span>
            <span class="mb-team-row__text">
              <span class="mb-team-row__name">{{ person.name }}<span v-if="isMe(person)" class="mb-team-row__you"> (you)</span></span>
              <span class="mb-team-row__line">{{ person.roleLabel }}</span>
            </span>
          </button>
          <button
            v-if="!isMe(person)"
            type="button"
            class="mb-set-pill mb-team-row__message"
            :aria-label="`Message ${person.name}`"
            @click="emit('message-person', person)"
          >
            Message
          </button>
        </li>

        <li
          v-for="bot in activeBots"
          :key="`bot:${bot.id}`"
          class="mb-team-row"
          :class="{ 'mb-team-row--selected': selected === `bot:${bot.id}` }"
          data-member="bot"
        >
          <button
            type="button"
            class="mb-team-row__open"
            :aria-label="`${bot.name}, ${madeLine(bot)}`"
            :aria-current="selected === `bot:${bot.id}` ? 'true' : undefined"
            @click="emit('open-member', `bot:${bot.id}`)"
          >
            <span class="mb-team-row__face"><MercbotAvatar :bot="bot" :size="36" still /></span>
            <span class="mb-team-row__text">
              <span class="mb-team-row__name">
                {{ bot.name }} <MercbotTemplateTag :bot="bot" :tooltip="false" /><span v-if="bot.isMain" class="mb-team-row__main">Main bot</span>
              </span>
              <span class="mb-team-row__line">
                {{ madeLine(bot) }}<span v-if="bot.template?.description" class="mb-team-row__does"> · {{ bot.template.description }}</span>
              </span>
            </span>
          </button>
          <button type="button" class="mb-set-pill mb-team-row__message" :aria-label="`Message ${bot.name}`" @click="emit('message-bot', bot)">
            Message
          </button>
        </li>
      </ul>

      <p v-if="justYou" class="mb-team-page__empty">Just you here so far. Add bots to start your team.</p>

      <template v-if="archivedBots.length">
        <h2 class="mb-team-page__heading">Archived</h2>
        <ul class="mb-team-page__list" aria-label="Archived bots">
          <li
            v-for="bot in archivedBots"
            :key="`bot:${bot.id}`"
            class="mb-team-row mb-team-row--archived"
            :class="{ 'mb-team-row--selected': selected === `bot:${bot.id}` }"
            data-member="archived"
          >
            <button
              type="button"
              class="mb-team-row__open"
              :aria-label="`${bot.name}, ${leftLine(bot)}`"
              :aria-current="selected === `bot:${bot.id}` ? 'true' : undefined"
              @click="emit('open-member', `bot:${bot.id}`)"
            >
              <span class="mb-team-row__face"><MercbotAvatar :bot="bot" :size="36" still /></span>
              <span class="mb-team-row__text">
                <span class="mb-team-row__name">{{ bot.name }}</span>
                <span class="mb-team-row__line">{{ leftLine(bot) }}</span>
              </span>
            </button>
            <button
              v-if="bot.canArchive"
              type="button"
              class="mb-set-pill mb-team-row__message"
              :aria-label="`Resume ${bot.name}`"
              @click="emit('unarchive-bot', bot)"
            >
              Resume
            </button>
          </li>
        </ul>
      </template>
    </template>
  </section>
</template>

<style scoped>
.mb-team-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  width: 100%;
  max-width: 760px;
  min-height: 0;
  margin: 0 auto;
  padding: 20px 24px 32px;
  overflow-y: auto;
  color: rgb(var(--v-theme-on-background));
}

.mb-team-page__bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px 16px;
  margin-bottom: 16px;
}

.mb-team-page__title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  font-size: 18px;
  font-weight: 600;
  line-height: 26px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-team-page__home {
  font-weight: 400;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-team-page__actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.mb-team-page__failed,
.mb-team-page__empty {
  margin: 4px 8px 16px;
  font-size: 14px;
  line-height: 20px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-team-page__retry {
  padding: 0 4px;
  border: 0;
  background: transparent;
  font: inherit;
  color: rgb(var(--v-theme-link));
  cursor: pointer;
}

.mb-team-page__heading {
  margin: 24px 8px 6px;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-team-page__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mb-team-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-right: 8px;
  border-radius: 12px;
}

.mb-team-row:hover,
.mb-team-row--selected {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-team-row__open {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 12px;
  min-width: 0;
  min-height: 56px;
  padding: 8px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.mb-team-row__open:focus-visible,
.mb-team-row__message:focus-visible,
.mb-team-page__add:focus-visible,
.mb-team-page__retry:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}

.mb-team-row__face {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  line-height: 0;
}

.mb-team-row__initials {
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-highest));
  font-size: 13px;
  font-weight: 600;
  line-height: 36px;
  color: rgb(var(--v-theme-on-surface));
}

.mb-team-row__text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.mb-team-row__name,
.mb-team-row__line {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-team-row__name {
  font-size: 14px;
  font-weight: 500;
  line-height: 20px;
}

.mb-team-row__main {
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 500;
  vertical-align: 1px;
  background: rgb(var(--v-theme-surface-variant));
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-team-row__you {
  font-weight: 400;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-team-row__line {
  font-size: 13px;
  line-height: 18px;
  color: rgb(var(--v-theme-on-surface-variant));
}

/* A bot that has left (D-108): greyed, as it is in its chats. */
.mb-team-row--archived .mb-team-row__face,
.mb-team-row--archived .mb-team-row__name {
  opacity: 0.6;
}

.mb-team-row--skeleton:hover {
  background: transparent;
}

.mb-team-row--skeleton {
  min-height: 56px;
  padding: 8px;
  gap: 12px;
}

.mb-team-row__face--skeleton,
.mb-team-row__bar {
  background: rgb(var(--v-theme-surface-container-high));
}

.mb-team-row__face--skeleton {
  border-radius: 50%;
}

.mb-team-row__bar {
  width: 40%;
  height: 12px;
  border-radius: 6px;
}

.mb-team-row__bar--short {
  width: 25%;
}

@media (max-width: 599px) {
  .mb-team-page {
    padding: 12px 16px 24px;
  }

  /* The shell's drawer button sits over the page's top left on a phone. */
  .mb-team-page__bar {
    padding-left: 40px;
  }

  .mb-team-row__does {
    display: none;
  }

  .mb-team-row__message,
  .mb-team-page__add {
    height: 36px;
    border-radius: 18px;
  }
}
</style>
