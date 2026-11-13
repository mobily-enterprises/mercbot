<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useHomes } from "./homesApi.js";
import MercbotFileViewer from "./MercbotFileViewer.vue";
import MercbotAppsSection from "../apps/MercbotAppsSection.vue";
import FileBrowser from "../files/FileBrowser.vue";
import MercbotPageShare from "./MercbotPageShare.vue";
import MercbotViewViewer from "@/components/apps/MercbotViewViewer.vue";
import { fileUrl } from "./filesApi.js";
import MercbotAvatar from "./MercbotAvatar.vue";
import MercbotConvoAvatar from "./MercbotConvoAvatar.vue";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotContextMenu from "./MercbotContextMenu.vue";
import MercbotIconButton from "./MercbotIconButton.vue";
import MercbotVncScreen from "./MercbotVncScreen.vue";
import extensions from "./extensions.js";
import { computerApi, useComputerStream } from "./computerApi.js";
import { emitResizeDrag } from "./pointerDrag.js";
import { shellPreferences } from "./shellPreferences.js";
import { itemAge, itemIcon, itemMeta, itemType, pageAccess, useBotLibrary } from "./useBotLibrary.js";
import { noteAge, useBotNotebook } from "./useBotNotebook.js";
import { useBotRoutines } from "./useBotRoutines.js";
import { useGroupMembers } from "./useGroupMembers.js";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import { COMPUTER_GREY } from "@/theme/palettes.js";

// Bot details panel: header with editable name and label, then three tabs.
const paths = usePaths();
const props = defineProps({
  width: { type: Number, required: true },
  bot: { type: Object, required: true },
  mood: { type: String, default: "idle" },
  // Every bot, for adding members to a group.
  allBots: { type: Array, default: () => [] },
  // The person looking, for what they may do with a group's people (D-46), and their name, for a page's Share.
  me: { type: String, default: "" },
  displayName: { type: String, default: "" }
});
const emit = defineEmits([
  "close", "resize", "rename", "label", "failure", "notify", "messages", "open-computer", "edit-routine", "add-member",
  "remove-member", "add-person", "remove-person", "sharing", "keep-out", "open-page"
]);

// Who sees what (D-36): owners and admins choose; everyone else sees the choice.
const { current: home, manages } = useHomes();
const SHARING = computed(() => [
  { value: "private", title: "Private", text: `Each person's chats with ${props.bot.name} are their own.` },
  { value: "mixed", title: "Mixed", text: `Chats are private. What helps everyone goes in ${home.value?.name || "the home"}'s notebook, which everyone can read.` },
  { value: "shared", title: "Shared", text: `Everyone in ${home.value?.name || "this home"} talks with ${props.bot.name} in named conversations they all see.` }
]);

const TABS = [
  { value: "details", title: "Details" },
  { value: "files", title: "Files" },
  { value: "library", title: "Library" },
  { value: "computer", title: "Computer" }
];

// A group has Details, Library and Members; a bot has Details, Files, Library and Computer (D-47).
const isGroup = computed(() => props.bot.kind === "group");
const tabs = computed(() => (isGroup.value
  ? [TABS[0], TABS[2], { value: "members", title: "Members" }]
  : TABS));
const tab = computed(() => {
  const chosen = shellPreferences.detailsTab;
  if (isGroup.value && (chosen === "computer" || chosen === "files")) return "details";
  if (!isGroup.value && chosen === "members") return "details";
  return chosen;
});

const { members, pendingRemoval, memberSearch, addOpen, addable, addMember, people, personOpen, pendingPerson, canRemove, addablePeople, addPerson } =
  useGroupMembers({
    bot: () => props.bot,
    allBots: () => props.allBots,
    me: () => props.me,
    home,
    manages,
    onAddMember: (bot) => emit("add-member", bot),
    onAddPerson: (person) => emit("add-person", person),
    onFailure: (error) => emit("failure", error)
  });

const initialsOf = (name) => String(name || "?").split(/\s+/u).map((part) => part[0]).join("").slice(0, 2).toUpperCase();

// Inline editing of the name and label: Enter or leaving the field saves, Escape cancels.
const editing = ref("");
const editValue = ref("");
const editInput = ref(null);

async function startEdit(field) {
  editing.value = field;
  editValue.value = field === "name" ? props.bot.name : props.bot.label || "";
  await nextTick();
  editInput.value?.focus();
  editInput.value?.select();
}

function commitEdit() {
  const field = editing.value;
  if (!field) return;
  editing.value = "";
  const value = editValue.value.trim();
  if (field === "name" && value && value !== props.bot.name) emit("rename", value);
  if (field === "label" && value !== (props.bot.label || "")) emit("label", value);
}

function onEditKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    commitEdit();
  } else if (event.key === "Escape") {
    event.preventDefault();
    event.stopPropagation();
    editing.value = "";
  }
}

const { libraryItems, libraryLoaded, expandedDays, openItem, libraryGroups, sharingItem, pendingDelete, itemMenu, openItemMenu, deletePage } =
  useBotLibrary({
    bot: () => props.bot,
    isGroup,
    tab,
    onFailure: (error) => emit("failure", error),
    onMessages: (changed) => emit("messages", changed)
  });
// A Library entry's hover card: when it was made, and for a page who can open it (pageAccess).
const madeAt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const accessOf = (item) => pageAccess(props.bot, item.path, home.value?.name);
const sharingOpen = computed({ get: () => Boolean(sharingItem.value), set: (value) => { if (!value) sharingItem.value = null; } });
// A page opens in place of the chat (D-74), from its row or its menu's Open.
watch(openItem, (item) => {
  if (item?.kind !== "page") return;
  openItem.value = null;
  emit("open-page", { path: item.path, botId: String(props.bot.id) });
});
const { notes, notesLoaded, notesNext, moreNotes, removeNote } = useBotNotebook({ bot: () => props.bot, isGroup, tab, onFailure: (error) => emit("failure", error) });

// Computer tab: asleep until clicked, then waking, then a live thumbnail.
const computerTab = computed(() => tab.value === "computer");
const { state: computerState, error: computerError } = useComputerStream(computed(() => props.bot.id), computerTab);

function wakeComputer() {
  if (computerState.value === "asleep") {
    computerState.value = "waking";
    computerApi.wake(props.bot.id).catch((error) => emit("failure", error));
  }
}

watch(() => props.bot.id, () => {
  editing.value = "";
}, { immediate: true });

const { routines, routinesLoaded, toggleRoutine, highlightedRoutineId, routineMenu, pendingRoutineDelete, openRoutineMenu, deleteRoutine } =
  useBotRoutines({ bot: () => props.bot, tab, onEdit: (routine) => emit("edit-routine", routine), onFailure: (error) => emit("failure", error) });
</script>

<template>
  <aside class="mb-details" :style="{ width: `${width}px` }" aria-label="Details">
    <div class="mb-details__top">
      <!-- What a copy built on Mercbot adds for a bot (extensions.js). -->
      <template v-if="!isGroup">
        <component :is="action.component" v-for="(action, at) in extensions.botActions" :key="at" :bot="bot" />
      </template>
      <MercbotIconButton icon="$close" label="Close details" @click="emit('close')" />
    </div>

    <div class="mb-details__head">
      <div class="mb-details__avatar"><MercbotConvoAvatar :bot="bot" :size="bot.kind === 'group' ? 64 : 58" :state="mood" /></div>
      <input
        v-if="editing === 'name'"
        ref="editInput"
        v-model="editValue"
        class="mb-details__field mb-details__field--name"
        aria-label="Bot name"
        maxlength="80"
        @keydown="onEditKeydown"
        @blur="commitEdit"
      >
      <button v-else type="button" class="mb-details__name" @click="startEdit('name')">{{ bot.name }}</button>
      <input
        v-if="editing === 'label'"
        ref="editInput"
        v-model="editValue"
        class="mb-details__field mb-details__field--label"
        aria-label="Bot label"
        maxlength="60"
        placeholder="Add a label"
        @keydown="onEditKeydown"
        @blur="commitEdit"
      >
      <button
        v-else-if="!isGroup"
        type="button"
        class="mb-details__label"
        :class="{ 'mb-details__label--empty': !bot.label }"
        @click="startEdit('label')"
      >
        {{ bot.label || "Add a label" }}
      </button>
    </div>

    <div class="mb-details__tabs" role="tablist" aria-label="Details sections">
      <button
        v-for="entry in tabs"
        :key="entry.value"
        type="button"
        role="tab"
        class="mb-details__tab"
        :class="{ 'mb-details__tab--selected': tab === entry.value }"
        :aria-selected="tab === entry.value"
        @click="shellPreferences.detailsTab = entry.value"
      >
        {{ entry.title }}
      </button>
    </div>

    <div class="mb-details__content" role="tabpanel">
      <p v-if="tab === 'details' && isGroup" class="mb-details__empty">
        Routines are jobs a bot repeats on a schedule. Set them up in one of your bots' own chats.
      </p>

      <!-- The bot's files (D-47): the person's own with it, the bot's for everyone, the home's. -->
      <FileBrowser
        v-else-if="tab === 'files'"
        :key="bot.id"
        :bot-id="bot.id"
        :refresh-key="bot.lastActivityAt || 0"
        :sections="[
          ...(bot.sharing === 'shared' ? [] : [{ key: 'mine', label: 'Just me', root: '/files/mine' }]),
          { key: 'bot', label: `Everyone using ${bot.name}`, root: '/files/bot' },
          { key: 'shared', label: home?.name || 'Whole home', root: '/files/shared' }
        ]"
      />

      <template v-else-if="tab === 'members'">
        <p class="mb-members__heading">People</p>
        <ul class="mb-members">
          <li v-for="person in people" :key="person.id" class="mb-member">
            <span class="mb-member__initials" aria-hidden="true">{{ initialsOf(person.name) }}</span>
            <span class="mb-member__name">{{ person.name }}{{ person.id === me ? " (you)" : "" }}</span>
            <button v-if="person.id === me" type="button" class="mb-member__remove" @click="pendingPerson = person">Leave</button>
            <button v-else-if="canRemove(person)" type="button" class="mb-member__remove" :aria-label="`Remove ${person.name}`" @click="pendingPerson = person">Remove</button>
          </li>
        </ul>
        <v-menu v-model="personOpen" location="bottom start" :offset="4" content-class="mb-popover" :close-on-content-click="false">
          <template #activator="{ props: personProps }">
            <button v-bind="personProps" type="button" class="mb-member mb-member--add">
              <span class="mb-member__plus"><v-icon icon="$add" size="14" /></span>
              <span class="mb-member__name">Add a person</span>
            </button>
          </template>
          <div class="mb-add-member">
            <button v-for="candidate in addablePeople" :key="candidate.id" type="button" class="mb-add-member__row" @click="addPerson(candidate)">
              <span class="mb-member__initials" aria-hidden="true">{{ initialsOf(candidate.name) }}</span>
              <span class="mb-member__name">{{ candidate.name }}</span>
            </button>
            <p v-if="!addablePeople.length" class="mb-add-member__empty">Everyone in {{ home?.name || "this home" }} is here</p>
          </div>
        </v-menu>
        <MercbotConfirmDialog
          :model-value="Boolean(pendingPerson)"
          :title="pendingPerson?.id === me ? (people.length === 1 ? 'Leave and delete this group?' : 'Leave this group?') : `Remove ${pendingPerson?.name} from this group?`"
          :confirm-label="pendingPerson?.id === me ? 'Leave' : 'Remove'"
          dim
          @update:model-value="pendingPerson = null"
          @confirm="emit('remove-person', pendingPerson)"
        />

        <p class="mb-members__heading">Bots</p>
        <ul class="mb-members">
          <li v-for="member in members" :key="member.id" class="mb-member">
            <MercbotAvatar :bot="member" :size="24" still />
            <span class="mb-member__name">{{ member.name }}</span>
            <!-- The last bot can't be removed: its Remove shows faded and does nothing. -->
            <button
              type="button"
              class="mb-member__remove"
              :class="{ 'mb-member__remove--inert': members.length < 2 }"
              :aria-label="`Remove ${member.name}`"
              :aria-disabled="members.length < 2"
              @click="members.length > 1 && (pendingRemoval = member)"
            >
              Remove
            </button>
          </li>
        </ul>
        <v-menu v-model="addOpen" location="bottom start" :offset="4" content-class="mb-popover" :close-on-content-click="false">
          <template #activator="{ props: addProps }">
            <button v-bind="addProps" type="button" class="mb-member mb-member--add" :disabled="members.length >= 6">
              <span class="mb-member__plus"><v-icon icon="$add" size="14" /></span>
              <span class="mb-member__name">{{ members.length >= 6 ? "The group is full" : "Add a bot" }}</span>
            </button>
          </template>
          <div class="mb-add-member">
            <input v-model="memberSearch" class="mb-add-member__search" placeholder="Search bots" aria-label="Search bots">
            <button v-for="candidate in addable" :key="candidate.id" type="button" class="mb-add-member__row" @click="addMember(candidate)">
              <MercbotAvatar :bot="candidate" :size="20" still />
              <span class="mb-member__name">{{ candidate.name }}</span>
            </button>
            <p v-if="!addable.length" class="mb-add-member__empty">No other bots to add</p>
          </div>
        </v-menu>
        <MercbotConfirmDialog
          :model-value="Boolean(pendingRemoval)"
          :title="`Remove ${pendingRemoval?.name} from this conversation?`"
          confirm-label="Remove"
          dim
          @update:model-value="pendingRemoval = null"
          @confirm="emit('remove-member', pendingRemoval)"
        />
      </template>

      <template v-else-if="tab === 'details'">
        <MercbotAppsSection v-if="!isGroup" :bot="bot" />
        <!-- Where it came from (D-43), so a bot added from a template or a link can be traced. -->
        <template v-if="bot.origin">
          <p class="mb-details__section">Came from</p>
          <p class="mb-details__origin">
            <a :href="paths.page(`/${encodeURIComponent(bot.origin.slug)}`, { surface: bot.origin.kind === 'gallery' ? 'templates' : 'share' })" target="_blank" rel="noopener">{{ bot.origin.name }}</a>
            by {{ bot.origin.creator }}, added {{ new Date(bot.origin.addedAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) }}
          </p>
        </template>
        <p class="mb-details__section">Who sees what</p>
        <div class="mb-sharing" role="radiogroup" aria-label="Who sees what">
          <button
            v-for="option in SHARING"
            :key="option.value"
            type="button"
            role="radio"
            class="mb-sharing__option"
            :aria-checked="bot.sharing === option.value"
            :disabled="!manages"
            @click="bot.sharing !== option.value && emit('sharing', option.value)"
          >
            <span class="mb-sharing__text">
              <span class="mb-sharing__title">
                {{ option.title }}
                <v-icon v-if="option.value === 'shared'" icon="$group" size="13" />
              </span>
              <span class="mb-sharing__description">{{ option.text }}</span>
            </span>
            <v-icon v-if="bot.sharing === option.value" icon="$check" size="16" class="mb-sharing__check" />
          </button>
        </div>
        <p v-if="!manages" class="mb-sharing__note">The home's owners and admins choose this.</p>

        <template v-if="bot.sharing === 'mixed'">
          <p class="mb-details__section">{{ home?.name || "Home" }} notebook</p>
          <div class="mb-sharing mb-notebook">
            <div v-if="!notesLoaded" class="mb-details__skeleton" aria-hidden="true" />
            <p v-else-if="!notes.length" class="mb-notebook__empty">
              Nothing noted yet. When {{ bot.name }} learns something in a chat that helps everyone here, it notes it and says so in one line.
            </p>
            <div v-for="note in notes" :key="note.id" class="mb-notebook__note">
              <span class="mb-sharing__text">
                <span class="mb-notebook__text">{{ note.text }}</span>
                <span class="mb-sharing__description">From {{ note.author }} · {{ noteAge(note.createdAt) }}</span>
              </span>
              <MercbotIconButton v-if="note.canRemove" icon="$close" :label="`Remove “${note.text}”`" tooltip="Remove" size="x-small" :icon-size="14" tone="bare" @click="removeNote(note)" />
            </div>
            <button v-if="notesNext" type="button" class="mb-notebook__more" @click="moreNotes">Show more</button>
            <div class="mb-notebook__keep">
              <span class="mb-sharing__description">Keep my chats with {{ bot.name }} out of it</span>
              <button
                type="button"
                role="switch"
                class="mb-switch"
                :class="{ 'mb-switch--on': bot.keepOutOfNotebook }"
                :aria-checked="bot.keepOutOfNotebook"
                aria-label="Keep my chats out of the notebook"
                @click="emit('keep-out', !bot.keepOutOfNotebook)"
              >
                <span class="mb-switch__knob" />
              </button>
            </div>
          </div>
        </template>

        <template v-if="routinesLoaded && routines.length">
          <p class="mb-details__section">Routines</p>
          <div class="mb-routines">
            <div
              v-for="routine in routines"
              :key="routine.id"
              class="mb-routine"
              :class="{ 'mb-routine--highlighted': highlightedRoutineId === routine.id }"
              @click="highlightedRoutineId = routine.id"
              @contextmenu.prevent="openRoutineMenu($event, routine)"
            >
              <span class="mb-routine__text">
                <span class="mb-routine__name">{{ routine.name }}</span>
                <span class="mb-routine__schedule">{{ routine.enabled ? routine.schedule : "Paused" }}</span>
              </span>
              <button
                type="button"
                role="switch"
                class="mb-switch"
                :class="{ 'mb-switch--on': routine.enabled }"
                :aria-checked="routine.enabled"
                :aria-label="`${routine.name} on or off`"
                @click.stop="toggleRoutine(routine)"
              >
                <span class="mb-switch__knob" />
              </button>
            </div>
          </div>
          <MercbotContextMenu v-model="routineMenu.open" :target="routineMenu.target" :items="routineMenu.items" />
          <MercbotConfirmDialog
            :model-value="Boolean(pendingRoutineDelete)"
            :title="`Delete ${pendingRoutineDelete?.name}?`"
            text="Deleting it stops all future runs. This can't be undone."
            @update:model-value="pendingRoutineDelete = null"
            @confirm="deleteRoutine"
          />
        </template>
        <div v-else-if="!routinesLoaded" class="mb-details__skeleton" aria-hidden="true" />
        <p v-else class="mb-details__empty">
          Routines are jobs {{ bot.name }} repeats on a schedule. Ask in the chat to set one up, for example a weekly summary.
        </p>
      </template>

      <template v-else-if="tab === 'library'">
        <div v-if="!isGroup && libraryItems.length" class="mb-library">
          <section v-for="group in libraryGroups" :key="group.label" class="mb-library__group">
            <p class="mb-library__day">{{ group.label }}</p>
            <!-- Hovering a row shows its card above it. -->
            <v-tooltip v-for="item in group.shown" :key="item.path" location="top start" :offset="2" :open-delay="450" content-class="mb-hover-card">
              <template #activator="{ props: cardProps }">
                <div v-bind="cardProps" class="mb-library__row" @contextmenu.prevent="openItemMenu($event, item)">
                  <button type="button" class="mb-library__open" :aria-label="`Open ${item.name}`" @click="openItem = item">
                    <img v-if="item.kind === 'picture'" class="mb-library__icon mb-library__thumb" :src="fileUrl(bot.id, item.path, { download: false })" alt="">
                    <span v-else class="mb-library__icon"><v-icon :icon="itemIcon(item)" size="18" /></span>
                    <span class="mb-library__text">
                      <span class="mb-library__name">{{ item.name }}</span>
                      <span class="mb-library__meta">{{ itemMeta(item) }}</span>
                    </span>
                    <v-icon v-if="item.pinned" icon="$keepFilled" size="14" class="mb-library__pin" />
                    <span class="mb-library__age">{{ itemAge(item.createdAt) }}</span>
                  </button>
                  <button type="button" class="mb-library__more" :aria-label="`More for ${item.name}`" aria-haspopup="menu" :aria-expanded="itemMenu.open && itemMenu.path === item.path" @click="openItemMenu($event, item)"><v-icon icon="$moreHoriz" size="16" /></button>
                </div>
              </template>
              <span class="mb-hover-card__type">{{ itemType(item) }}</span>
              <span class="mb-hover-card__title">{{ item.name }}</span>
              <span class="mb-hover-card__line"><MercbotConvoAvatar :bot="bot" :size="16" still />{{ bot.name }}</span>
              <span class="mb-hover-card__line">{{ madeAt.format(new Date(item.createdAt)) }}</span>
              <span v-if="item.kind === 'page'" class="mb-hover-card__line"><v-icon :icon="accessOf(item).icon" size="14" />{{ accessOf(item).title }}</span>
            </v-tooltip>
            <button v-if="group.more" type="button" class="mb-library__show-more" @click="expandedDays = new Set([...expandedDays, group.label])">Show more</button>
          </section>
        </div>
        <div v-else-if="!isGroup && !libraryLoaded" class="mb-details__skeleton" aria-hidden="true" />
        <p v-else class="mb-details__empty">
          Anything {{ bot.name }} creates for you, like pages, files and apps, will be kept here.
        </p>
        <MercbotContextMenu v-model="itemMenu.open" :target="itemMenu.target" :items="itemMenu.items" />
        <MercbotPageShare
          v-if="sharingItem"
          v-model="sharingOpen"
          :bot-id="String(bot.id)"
          :path="sharingItem.path"
          :title="sharingItem.name"
          :access="accessOf(sharingItem)"
          :display-name="displayName"
          @copied="emit('notify', $event)"
          @failure="emit('failure', $event)"
        />
        <MercbotConfirmDialog
          :model-value="Boolean(pendingDelete)"
          :title="`Delete “${pendingDelete?.name ?? ''}”?`"
          text="The page is deleted for good, with its ticks. Its cards in the chat stay, marked deleted. This can't be undone."
          @update:model-value="pendingDelete = null"
          @confirm="deletePage"
        />
        <MercbotViewViewer v-if="openItem?.kind === 'view'" :slug="openItem.path" :title="openItem.name" @close="openItem = null" />
        <MercbotFileViewer v-else-if="openItem" :bot-id="String(bot.id)" :file="{ path: openItem.path, name: ['chart', 'picture'].includes(openItem.kind) ? `${openItem.name}.png` : openItem.name }" @close="openItem = null" />
      </template>

      <template v-else>
        <button
          v-if="computerState === 'awake'"
          type="button"
          class="mb-computer mb-computer--live"
          :aria-label="`Open ${bot.name}'s screen`"
          @click="emit('open-computer')"
        >
          <MercbotVncScreen :bot-id="bot.id" awake class="mb-computer__vnc" />
          <span class="mb-computer__open"><v-icon icon="$expandContent" size="14" /> Open</span>
        </button>
        <button
          v-else
          type="button"
          class="mb-computer"
          :disabled="computerState !== 'asleep'"
          @click="wakeComputer"
        >
          <MercbotAvatar :bot="{ ...bot, color: COMPUTER_GREY }" :size="40" :state="computerState === 'asleep' ? 'asleep' : 'attention'" />
          <span class="mb-computer__text" :class="{ 'mb-computer__text--waking': computerState !== 'asleep' }">
            {{ computerState === "asleep" ? "The computer is sleeping. Click to wake it" : "Starting up" }}
          </span>
          <span v-if="computerError" class="mb-computer__error">{{ computerError }}</span>
        </button>
        <p class="mb-computer__caption">{{ bot.name }}'s screen</p>
      </template>
    </div>

    <div
      class="mb-details__resize"
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize details"
      @pointerdown.prevent="emitResizeDrag($event, emit)"
    />
  </aside>
</template>

<style scoped src="./MercbotDetailsPanel.css"></style>
