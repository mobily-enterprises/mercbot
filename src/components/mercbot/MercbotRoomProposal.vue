<script setup>
import { computed } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import { initialsOf } from "./messageAuthors.js";

// What a bot's start_room card proposes (D-122), inside its question card: the room's name, Private or Public, who is
// in it and the brief that will be its first message; once the person said yes, the room to open.
const props = defineProps({
  // The card's action arguments: { title, kind, bots: [{ id, name }], people: [{ id, name }], brief }.
  room: { type: Object, required: true },
  // The started room ({ chatId }), once the yes made it.
  done: { type: Object, default: null },
  // The home's bots (null while they load), for each bot's face.
  bots: { type: Array, default: null }
});
const emit = defineEmits(["open-chat"]);

const isPublic = computed(() => props.room.kind === "public");
const botFaces = computed(() => (props.room.bots || []).map((bot) => {
  const home = (props.bots || []).find((entry) => String(entry.id) === String(bot.id));
  return { id: String(bot.id), name: bot.name, face: { id: String(bot.id), name: bot.name, color: home?.color ?? null, shape: home?.shape ?? null } };
}));
const people = computed(() => (props.room.people || []).map((person) => ({ id: String(person.id), name: person.name, initials: initialsOf(person.name) })));
</script>

<template>
  <div class="mb-room-card">
    <div class="mb-room-card__head">
      <span class="mb-room-card__title">{{ room.title }}</span>
      <span class="mb-room-card__kind text-label-medium">
        <v-icon :icon="isPublic ? '$group' : '$lock'" size="14" />
        {{ isPublic ? "Public" : "Private" }}
      </span>
    </div>
    <ul class="mb-room-card__members" aria-label="In the room">
      <li v-for="person in people" :key="`person-${person.id}`" class="mb-room-card__member text-label-medium">
        <span class="mb-room-card__initials" aria-hidden="true">{{ person.initials }}</span>
        {{ person.name }}
      </li>
      <li v-for="bot in botFaces" :key="`bot-${bot.id}`" class="mb-room-card__member text-label-medium">
        <MercbotAvatar :bot="bot.face" :size="20" still />
        {{ bot.name }}
      </li>
    </ul>
    <p class="mb-room-card__brief text-body-medium" tabindex="0" role="region" aria-label="The room's brief">{{ room.brief }}</p>
    <v-btn v-if="done?.chatId" class="mb-room-card__open" color="primary" variant="flat" prepend-icon="$openInNew" @click="emit('open-chat', String(done.chatId))">
      Open the room
    </v-btn>
  </div>
</template>

<style scoped>
.mb-room-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 12px;
}

.mb-room-card__head {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.mb-room-card__title {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-room-card__kind {
  display: inline-flex;
  flex: none;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 8px;
  background: rgb(var(--v-theme-secondary-container));
  color: rgb(var(--v-theme-on-secondary-container));
}

.mb-room-card__members {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.mb-room-card__member {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px 2px 2px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface));
}

.mb-room-card__initials {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border-radius: 50%;
  background: rgb(var(--v-theme-tertiary-container));
  color: rgb(var(--v-theme-on-tertiary-container));
  font-size: 10px;
  font-weight: 600;
}

.mb-room-card__brief {
  max-height: 200px;
  margin: 0;
  overflow-y: auto;
  padding: 8px 10px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface-container-low));
  color: rgb(var(--v-theme-on-surface));
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.mb-room-card__open {
  align-self: flex-start;
}
</style>
