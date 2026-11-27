<script setup>
import { computed, ref, watch } from "vue";
import FileBrowser from "../files/FileBrowser.vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotChatAvatar from "./MercbotChatAvatar.vue";
import MercbotChatComputers from "./MercbotChatComputers.vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import { chatQuestion, chatRights } from "./chatMenus.js";
import { botFace, chatTitle, kindIcon, kindLabel, kindMeaning } from "./chatView.js";
import { chatsApi } from "./chatsApi.js";
import { shellPreferences } from "./shellPreferences.js";
import { initialsOf } from "./messageAuthors.js";

// Chat details (plan 4.4), for any chat but a direct one: who's in it (each opens their card), whether it's Public or
// Private and what that means, its files, its bots' computers (D16) and routines, and leave, archive or delete. Every
// change is a command for the shell, which the server refuses for anyone it isn't theirs to make.
const props = defineProps({
  chat: { type: Object, required: true },
  me: { type: String, default: "" },
  homeName: { type: String, default: "this home" },
  manages: { type: Boolean, default: false },
  computerNews: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["open-member", "command", "open-computer", "edit-routine", "failure"]);

const command = (name, args = {}) => emit("command", { name, args });
const title = computed(() => chatTitle(props.chat, props.me));
const may = computed(() => chatRights(props.chat, { me: props.me, manages: props.manages }));
const inIt = computed(() => !props.chat.visiting);

// Its tabs: the chat itself, its folder, and its bots' computers; the one open is kept on this device.
const TABS = [
  { value: "details", title: "Chat" },
  { value: "files", title: "Files" },
  { value: "computer", title: "Computers" }
];
const tab = computed({
  get: () => (TABS.some((entry) => entry.value === shellPreferences.detailsTab) ? shellPreferences.detailsTab : "details"),
  set: (value) => { shellPreferences.detailsTab = value; }
});

// Its title, renamed here by its maker and the home's owners and admins; an empty title names it by who's in it.
const renaming = ref(false);
const titleDraft = ref("");
function startRename() {
  titleDraft.value = props.chat.title || "";
  renaming.value = true;
}
function commitRename() {
  if (!renaming.value) return;
  renaming.value = false;
  if ((titleDraft.value.trim() || null) !== (props.chat.title || null)) command("renameChat", { chatId: props.chat.id, title: titleDraft.value.trim() || null });
}

const people = computed(() => [...props.chat.people].sort((a, b) =>
  Number(String(b.userId) === String(props.me)) - Number(String(a.userId) === String(props.me))));
// Its maker and the home's owners and admins take people out; the everyone chat has everyone in the home. A bot is
// taken out by anyone in the home from a public room, by its people from a private one.
const mayRemovePerson = (person) => may.value.removeMembers && !props.chat.everyone && String(person.userId) !== String(props.me);
// Whether its bots join in when useful (D-115): they and everyone else see it; they switch it.
const joinInNote = computed(() => (may.value.joinIn
  ? "On: a bot may reply without being called. Off: only when called."
  : "Only the person who started this chat and the home's owners and admins can change this."));

// Routines that run in this chat (B): each one's bot, schedule, a switch (anyone pauses one; only its maker resumes it,
// canResume), Edit through the chat for its maker too (only they change it, routineTools.js), and Delete, which is
// anyone's who can open the chat.
const routines = ref(null);
async function loadRoutines() {
  try {
    routines.value = (await chatsApi.routinesIn(props.chat.id)).routines || [];
  } catch (error) {
    routines.value = [];
    emit("failure", error);
  }
}
watch(() => props.chat.id, loadRoutines, { immediate: true });
const botName = (botId) => props.chat.bots.find((bot) => String(bot.botId) === String(botId))?.name || "A bot";
async function switchRoutine(routine) {
  try {
    const { routine: changed } = await chatsApi.switchRoutine(routine.id, !routine.enabled);
    routines.value = routines.value.map((entry) => (entry.id === changed.id ? changed : entry));
  } catch (error) {
    emit("failure", error);
  }
}
const deletingRoutine = ref(null);
async function deleteRoutine() {
  const routine = deletingRoutine.value;
  deletingRoutine.value = null;
  try {
    const { deleted } = await chatsApi.removeRoutine(routine.id);
    routines.value = routines.value.filter((entry) => entry.id !== deleted);
  } catch (error) {
    emit("failure", error);
  }
}

// Leave, Archive and Delete ask first.
const asking = ref("");
const question = computed(() => (asking.value ? chatQuestion(asking.value, props.chat, title.value) : null));
const ASKED = { archive: "archiveChat", leave: "leaveChat", remove: "deleteChat" };
function confirmAsked() {
  command(ASKED[asking.value], { chatId: props.chat.id });
  asking.value = "";
}
</script>

<template>
  <div class="mb-chat-details">
    <div class="mb-chat-details__head">
      <MercbotChatAvatar :chat="chat" :me="me" :size="40" still />
      <div class="mb-chat-details__names">
        <input
          v-if="renaming"
          v-model="titleDraft"
          class="mb-chat-details__rename"
          aria-label="Chat name"
          placeholder="Its members' names"
          maxlength="120"
          @keydown.enter.prevent="commitRename"
          @keydown.esc.stop.prevent="renaming = false"
          @blur="commitRename"
        >
        <h2 v-else class="mb-chat-details__title">
          {{ title }}
          <button v-if="may.rename" type="button" class="mb-chat-details__edit" aria-label="Rename chat" @click="startRename">
            <v-icon icon="$edit" size="14" />
          </button>
        </h2>
        <p class="mb-chat-details__kind">
          <v-icon :icon="kindIcon(chat)" size="14" />
          <span>{{ kindLabel(chat) }}<template v-if="chat.archivedAt"> · Archived</template></span>
        </p>
      </div>
    </div>
    <p class="mb-chat-details__means">{{ kindMeaning(chat, homeName) }}</p>

    <v-tabs v-model="tab" density="compact" class="mb-chat-details__tabs">
      <v-tab v-for="entry in TABS" :key="entry.value" :value="entry.value">{{ entry.title }}</v-tab>
    </v-tabs>

    <template v-if="tab === 'details'">
      <section class="mb-chat-details__group" aria-label="People">
        <h3>People</h3>
        <ul class="mb-chat-details__members">
          <li v-for="person in people" :key="person.userId">
            <button type="button" class="mb-chat-details__member" @click="emit('open-member', `person:${person.userId}`)">
              <span class="mb-chat-details__initials">{{ initialsOf(person.name) }}</span>
              <span class="mb-chat-details__member-name">{{ person.name }}<template v-if="String(person.userId) === String(me)"> (you)</template></span>
            </button>
            <button
              v-if="mayRemovePerson(person)"
              type="button"
              class="mb-chat-details__remove"
              :aria-label="`Take ${person.name} out of this chat`"
              @click="command('removePerson', { chatId: chat.id, userId: String(person.userId) })"
            >
              <v-icon icon="$close" size="14" />
            </button>
          </li>
        </ul>
      </section>

      <section class="mb-chat-details__group" aria-label="Bots">
        <h3>Bots</h3>
        <p v-if="!chat.bots.length" class="mb-chat-details__none">No bots in this chat.</p>
        <ul v-else class="mb-chat-details__members">
          <li v-for="member in chat.bots" :key="member.botId">
            <button type="button" class="mb-chat-details__member" @click="emit('open-member', `bot:${member.botId}`)">
              <MercbotAvatar :bot="botFace(member)" :size="24" still />
              <span class="mb-chat-details__member-name">{{ member.name }}<template v-if="member.archived"> · archived</template></span>
            </button>
            <button
              v-if="may.removeBots"
              type="button"
              class="mb-chat-details__remove"
              :aria-label="`Take ${member.name} out of this chat`"
              @click="command('removeBot', { chatId: chat.id, botId: String(member.botId) })"
            >
              <v-icon icon="$close" size="14" />
            </button>
          </li>
        </ul>
        <div v-if="chat.bots.length && !chat.directBotId" class="mb-chat-details__setting">
          <span class="mb-chat-details__routine-text">
            <span class="mb-chat-details__routine-name">Bots join in when useful</span>
            <span class="mb-chat-details__routine-when">{{ joinInNote }}</span>
          </span>
          <v-switch
            :model-value="Boolean(chat.botsJoinIn)"
            :disabled="!may.joinIn"
            color="primary"
            density="compact"
            hide-details
            inset
            aria-label="Bots join in when useful"
            @update:model-value="command('setJoinIn', { chatId: chat.id, on: Boolean($event) })"
          />
        </div>
      </section>

      <section class="mb-chat-details__group" aria-label="Routines">
        <h3>Routines</h3>
        <p v-if="routines === null" class="mb-chat-details__none">Loading…</p>
        <p v-else-if="!routines.length" class="mb-chat-details__none">No routines run in this chat. Ask a bot here to do something on a schedule.</p>
        <ul v-else class="mb-chat-details__routines">
          <li v-for="routine in routines" :key="routine.id" class="mb-chat-details__routine">
            <span class="mb-chat-details__routine-text">
              <span class="mb-chat-details__routine-name">{{ routine.name }}</span>
              <span class="mb-chat-details__routine-when">{{ routine.enabled ? routine.schedule : "Paused" }} · {{ botName(routine.botId) }}</span>
            </span>
            <v-switch
              :model-value="routine.enabled"
              :disabled="!routine.enabled && !routine.canResume"
              color="primary"
              density="compact"
              hide-details
              inset
              :aria-label="routine.enabled ? `Pause ${routine.name}` : `Resume ${routine.name}`"
              @update:model-value="switchRoutine(routine)"
            />
            <v-btn v-if="routine.canResume" icon="$edit" size="28" variant="text" :aria-label="`Edit ${routine.name}`" @click="emit('edit-routine', routine)" />
            <v-btn
              icon="$delete"
              size="28"
              variant="text"
              :aria-label="`Delete ${routine.name}`"
              @click="deletingRoutine = routine"
            />
          </li>
        </ul>
      </section>

      <section class="mb-chat-details__group mb-chat-details__actions" aria-label="This chat">
        <button v-if="may.leave && inIt" type="button" class="mb-chat-details__action" @click="asking = 'leave'">
          <v-icon icon="$logout" size="16" /> Leave chat
        </button>
        <button v-if="may.archive && !chat.archivedAt" type="button" class="mb-chat-details__action" @click="asking = 'archive'">
          <v-icon icon="$archive" size="16" /> Archive
        </button>
        <button v-if="chat.kind === 'private' && !chat.archivedAt && !chat.hidden && inIt" type="button" class="mb-chat-details__action" @click="command('hide', { chatId: chat.id })">
          <v-icon icon="$visibilityOff" size="16" /> Hide from sidebar
        </button>
        <button v-if="may.unarchive && chat.archivedAt" type="button" class="mb-chat-details__action" @click="command('unarchiveChat', { chatId: chat.id })">
          <v-icon icon="$unarchive" size="16" /> Unarchive
        </button>
        <button v-if="may.remove" type="button" class="mb-chat-details__action mb-chat-details__action--danger" @click="asking = 'remove'">
          <v-icon icon="$delete" size="16" /> Delete chat
        </button>
        <p v-if="chat.everyone" class="mb-chat-details__none">Everyone in {{ homeName }} is in this chat, for as long as they're in the home.</p>
      </section>
    </template>

    <!-- The file browser, opened at this chat's folder, with every other place beside it. -->
    <FileBrowser v-else-if="tab === 'files'" :key="`files-${chat.id}`" :chat="chat" />

    <MercbotChatComputers
      v-else
      :chat="chat"
      :me="me"
      :home-name="homeName"
      :manages="manages"
      :computer-news="computerNews"
      @open-live="emit('open-computer', $event)"
      @failure="emit('failure', $event)"
    />

    <MercbotConfirmDialog
      :model-value="Boolean(question)"
      :title="question?.title || ''"
      :text="question?.text || ''"
      :confirm-label="question?.confirmLabel"
      :danger="Boolean(question?.danger)"
      @update:model-value="!$event && (asking = '')"
      @confirm="confirmAsked"
    />
    <MercbotConfirmDialog
      :model-value="Boolean(deletingRoutine)"
      :title="`Delete “${deletingRoutine?.name || ''}”?`"
      text="It stops for good, in this chat and everywhere."
      @update:model-value="!$event && (deletingRoutine = null)"
      @confirm="deleteRoutine"
    />
  </div>
</template>

<style scoped>
.mb-chat-details {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mb-chat-details__head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.mb-chat-details__names {
  min-width: 0;
}

.mb-chat-details__title {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  overflow-wrap: anywhere;
}

.mb-chat-details__edit,
.mb-chat-details__remove {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: 0;
  border-radius: 50%;
  background: none;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-chat-details__rename {
  width: 100%;
  padding: 2px 6px;
  border: 1px solid rgb(var(--v-theme-primary));
  border-radius: 6px;
  font: inherit;
  font-size: 15px;
  color: rgb(var(--v-theme-on-surface));
}

.mb-chat-details__kind {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 2px 0 0;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-chat-details__means,
.mb-chat-details__none {
  margin: 0;
  font-size: 12px;
  line-height: 17px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-chat-details__group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mb-chat-details__group h3 {
  margin: 6px 0 2px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-chat-details__members,
.mb-chat-details__routines {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mb-chat-details__members li,
.mb-chat-details__routine,
.mb-chat-details__setting {
  display: flex;
  align-items: center;
  gap: 6px;
}

.mb-chat-details__setting {
  margin-top: 6px;
}

/* Material 3's switch when off: an outlined track and an outline-coloured thumb, so it reads as a switch on any surface. */
.mb-chat-details :deep(.v-switch .v-selection-control:not(.v-selection-control--dirty) .v-switch__track) {
  background: rgb(var(--v-theme-surface-container-highest));
  border: 2px solid rgb(var(--v-theme-outline));
  opacity: 1;
}

.mb-chat-details :deep(.v-switch .v-selection-control:not(.v-selection-control--dirty) .v-switch__thumb) {
  background: rgb(var(--v-theme-outline));
  color: rgb(var(--v-theme-outline));
}

.mb-chat-details__member {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  height: 36px;
  padding: 0 6px;
  border: 0;
  border-radius: 8px;
  background: none;
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  text-align: left;
  cursor: pointer;
}

.mb-chat-details__member:hover {
  background: rgb(var(--v-theme-surface-container-highest));
}

.mb-chat-details__member-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-chat-details__initials {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-highest));
  font-size: 9px;
  font-weight: 700;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-chat-details__routine-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.mb-chat-details__routine-name {
  font-size: 13px;
}

.mb-chat-details__routine-when {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-chat-details__actions {
  padding-top: 8px;
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
}

.mb-chat-details__action {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 34px;
  padding: 0 6px;
  border: 0;
  border-radius: 8px;
  background: none;
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface));
  text-align: left;
  cursor: pointer;
}

.mb-chat-details__action:hover {
  background: rgb(var(--v-theme-surface-container-highest));
}

.mb-chat-details__action--danger {
  color: rgb(var(--v-theme-error));
}
</style>
