<script setup>
import { computed, provide, ref, watch } from "vue";
import { loadBuilderBot } from "./builderBot.js";
import { useRoute, useRouter } from "vue-router";
import { useWebPlacementContext } from "@jskit-ai/shell-web/client/placement";
import { useAuthStore } from "@jskit-ai/auth-web/client";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import MercbotChatPanel from "./MercbotChatPanel.vue";
import { refusedWork } from "./accountApi.js";
import extensions from "./extensions.js";
import MercbotDetailsPanel from "./MercbotDetailsPanel.vue";
import MercbotAppsModal from "./MercbotAppsModal.vue";
import MercbotLiveView from "./MercbotLiveView.vue";
import MercbotFileViewer from "./MercbotFileViewer.vue";
import MercbotViewViewer from "@/components/apps/MercbotViewViewer.vue";
import MercbotConnectExplainer from "./MercbotConnectExplainer.vue";
import MercbotNewBotDialog from "./MercbotNewBotDialog.vue";
import MercbotTemplatePreview from "./MercbotTemplatePreview.vue";
import MercbotSearchPalette from "./MercbotSearchPalette.vue";
import MercbotShortcutsDialog from "./MercbotShortcutsDialog.vue";
import MercbotAboutDialog from "./MercbotAboutDialog.vue";
import MercbotSettingsDialog from "./MercbotSettingsDialog.vue";
import { EVERYONE_SECTIONS } from "./settingsSections.js";
import MercbotSidebar from "./MercbotSidebar.vue";
import { buildSidebarModel, railOrder } from "./botDirectory.js";
import { composerPlaceholder } from "./composerPlaceholder.js";
import { useHomes } from "./homesApi.js";
import { DETAILS_MIN } from "./shellGeometry.js";
import { shellPreferences } from "./shellPreferences.js";
import { MERCBOT_INITIALS_KEY, uploadedPicture } from "./shellInitials.js";
import { MERCBOT_CHAT_KEY, createKeyHolds } from "./shellChat.js";
import MercbotIconButton from "./MercbotIconButton.vue";
import { useBotEvents } from "./useBotEvents.js";
import { useBotMessages } from "./useBotMessages.js";
import { useBotWork } from "./useBotWork.js";
import { useChatActions } from "./useChatActions.js";
import { useConnectApps } from "./useConnectApps.js";
import { useDrafts } from "./useDrafts.js";
import { useGroupPicker } from "./useGroupPicker.js";
import { useLiveView } from "./useLiveView.js";
import { useNewBot } from "./useNewBot.js";
import { useOnboarding } from "./useOnboarding.js";
import { useOpenPage } from "./useOpenPage.js";
import { usePaletteRunner } from "./usePaletteRunner.js";
import { useRooms } from "./useRooms.js";
import { useShellDialogs } from "./useShellDialogs.js";
import { useShellKeys } from "./useShellKeys.js";
import { useShellLayout } from "./useShellLayout.js";
import { useShellTheme } from "./useShellTheme.js";
import { useSidebarCommands } from "./useSidebarCommands.js";

// The signed-in Mercbot shell around the user's saved bots and conversations (D-8).
// The composables beside it hold each part; the shell joins them and opens the dialogs.
const props = defineProps({
  initialBots: { type: Array, required: true },
  initialSections: { type: Array, default: () => [] }
});

const bots = ref(props.initialBots);
const sections = ref(props.initialSections);
const editingSectionId = ref("");
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { context: placementContext } = useWebPlacementContext();
const myId = computed(() => String(placementContext.value?.user?.id || ""));
const { current: currentHomeEntry } = useHomes();
const homeName = computed(() => currentHomeEntry.value?.name || "this home");
const errorRuntime = useShellWebErrorRuntime();

// The parts a copy built on Mercbot adds to the shell (extensions.js shellParts): above the open conversation's composer
// (place "notice"), or beside the shell's dialogs.
const noticeParts = extensions.shellParts.filter((part) => part.place === "notice");
const dialogParts = extensions.shellParts.filter((part) => part.place !== "notice");

function reportFailure(message, cause) {
  // Work the copy refused says why (accountApi.js refusedWork).
  const said = refusedWork(cause) ? cause.message || message : message;
  errorRuntime.report({ source: "mercbot.chat", message: said, cause, intent: "action-feedback", severity: "error" });
}

function notify(message) {
  errorRuntime.report({ source: "mercbot.chat", message, intent: "action-feedback", severity: "success" });
}

const { geometry, detailsShown, showDetails, closeDetails, drawerOpen, toggleCompact, resizeSidebar, resizeDetails } = useShellLayout();
const sidebarModel = computed(() => buildSidebarModel({
  bots: bots.value,
  sections: sections.value,
  hiddenExpanded: shellPreferences.hiddenExpanded
}));
const visualOrder = computed(() => (geometry.value.compact ? railOrder(sidebarModel.value) : sidebarModel.value.visualOrder));
// A bot still being created (useNewBot) is only its row: it never opens, so nothing asks the server
// about it before it exists. The chat stays on the bot it shows until the new one exists, then moves
// to it, even when no bot is named in the address and the new row is first in the list.
const openable = (id) => bots.value.find((bot) => bot.id === id && !bot.creating);
const firstOpenable = () => visualOrder.value.find(openable);
// With no bot named in the address (the home's own address, or a bot that's gone), the chat opens on
// the first bot in the list and keeps it: another bot's news puts that bot first, never the chat on it.
// Back to such an address shows that bot again.
const unnamedBotId = ref("");
const currentBot = computed(() =>
  openable(route.query.bot) ||
  openable(unnamedBotId.value) ||
  openable(firstOpenable()) ||
  bots.value.find((bot) => !bot.creating)
);
watch(() => currentBot.value.id, (botId) => {
  if (!openable(route.query.bot)) unnamedBotId.value = botId;
}, { immediate: true });
const currentBotId = () => currentBot.value.id;
const currentIndex = computed(() => visualOrder.value.indexOf(currentBot.value.id));
const hints = computed(() => (positionHints.value
  ? Object.fromEntries(visualOrder.value.slice(0, 9).map((id, index) => [id, index + 1]))
  : {}));
const { drafts, currentDraft } = useDrafts({ currentBotId });

const store = useBotMessages({ bots, currentBotId });
const { messagesByBot, olderByBot, markSeen } = store;
const work = useBotWork({ bots, store });
const { workByBot, speakersByBot, moodByBot } = work;
const currentMessages = computed(() => (picker.value ? [] : messagesByBot.value[currentBot.value.id] || []));
const { openPage, showPage, closePage, chatQuery } = useOpenPage({ route, router, messages: currentMessages, bots, currentBot });
const { picker, pickerBots, accentColor, chatDraft, openGroupPicker, startGroup } =
  useGroupPicker({ bots, currentBot, currentDraft, store, work, selectBot, reportFailure });
// The page shown in place of the chat; on a phone it has the screen, with its own Close.
const shownPage = computed(() => (picker.value ? null : openPage.value));
const status = computed(() => (picker.value ? "" : workByBot.value[currentBot.value.id] || onboardingTiming.value?.status || ""));
// In a group, the status line shows the bots that are working.
const statusBots = computed(() => (speakersByBot.value[currentBot.value.id] || [])
  .map((id) => currentBot.value.members?.find((member) => member.id === id))
  .filter(Boolean));
const statusMood = computed(() => {
  const mood = moodByBot.value[currentBot.value.id];
  return mood === "thinking" || mood === "attention" ? mood : "working";
});
const placeholder = computed(() => composerPlaceholder({
  pickerNames: picker.value ? pickerBots.value.map((bot) => bot.name) : null,
  messages: currentMessages.value,
  bot: currentBot.value,
  homeName: homeName.value
}));

const displayName = computed(() => {
  const user = placementContext.value?.user || {};
  return String(user.displayName || user.name || auth.username || "").trim() || "Account";
});
const initials = computed(() => {
  const words = displayName.value.split(/\s+/u).filter(Boolean);
  return (words.length > 1 ? `${words[0][0]}${words[1][0]}` : displayName.value.slice(0, 2)).toUpperCase();
});
// The account button's picture, from the user JSKIT's bootstrap keeps in the placement context, which it reads again
// as the person comes back from their settings.
const picture = computed(() => uploadedPicture(placementContext.value?.user));

// Group avatars show the person's initials.
provide(MERCBOT_INITIALS_KEY, initials);

const chatPanel = ref(null);
const { shortcutsOpen, settingsOpen, settingsSection, openSettings, aboutOpen, findOpen } = useShellDialogs({ route, router });
// The open chat's page before its oldest loaded message, as the person scrolls up.
const loadOlder = () => store.loadOlder(currentBot.value.id).catch((error) => reportFailure("Older messages didn't load.", error));
// Find in chat counts the matches in the pages not loaded yet on the server, and brings the pages down to
// one only when the person goes to it.
const findOlder = (text) => store.findOlder(currentBot.value.id, text);
const loadThrough = (messageId) => store.loadThrough(currentBot.value.id, messageId)
  .catch((error) => reportFailure("Older messages didn't load.", error));

const { themePreference, setTheme } = useShellTheme({ accentColor, reportFailure });
const { selectRoom, createRoom, renameRoom, undoNote, keepOutOfNotebook, setSharing } = useRooms({ currentBot, store, reportFailure });

// Opening a bot with unread messages puts the "new" divider above the first of them. It stays
// for this visit and is gone the next time the bot is opened.
const unreadAfterByBot = ref({});

watch(() => currentBot.value.id, (botId) => {
  const bot = currentBot.value;
  unreadAfterByBot.value = { ...unreadAfterByBot.value, [botId]: bot.unread ? bot.readUpTo || "0" : null };
  if (bot.unread) markSeen(botId);
}, { immediate: true });

useBotEvents({ store, work, dropBot });

function focusComposer() {
  chatPanel.value?.focusComposer();
}

// Edit goes through the chat: the composer gets a request naming the routine.
function editRoutine(routine) {
  currentDraft.value = `Edit your routine "${routine.name}": `;
  focusComposer();
}

const { onboardingTiming, chooseName } = useOnboarding({ currentBot, store, focusComposer, reportFailure });

const { appsOpen, appsSkillId, appsAppId, explainerOpen, explainerPlugin, openApp, openSkill, explainConnect, continueConnect } =
  useConnectApps({ reportFailure, currentBot });
const mainBot = computed(() => bots.value.find((bot) => bot.isMain) || null);
const { liveView, liveBot, openComputer, takeOver, workOnFile, teach, finishTeaching, settleHandover } =
  useLiveView({ currentBot, bots, store, work, reportFailure });

const paletteOpen = ref(false);
const { newBotOpen, creating, createError, newBotName, openNewBot, createBot } = useNewBot({ bots, store, picker, selectBot });

// A bot from a template or a shared link: ?template=<code> opens its preview; once added it
// goes to the top of the list and its chat opens.
const templateSlug = computed(() => (route.query.template ? String(route.query.template) : ""));
function closeTemplate(extra = {}) {
  const { template: _shown, ...rest } = route.query;
  router.replace({ query: { ...rest, ...extra } });
}
function addedFromTemplate({ bot, appNote }) {
  bots.value = [bot, ...bots.value];
  closeTemplate({ bot: bot.id });
  if (appNote) setTimeout(() => chatPanel.value?.showToast(appNote), 600);
}

// The chat, for the parts a copy built on Mercbot adds beside the shell's dialogs, to Details and to the timeline
// (shellChat.js). A part's dialog keeps the keyboard shortcuts away while it's open, as the shell's own dialogs do.
const keyHolds = createKeyHolds();
provide(MERCBOT_CHAT_KEY, Object.freeze({
  appendMessages: store.appendMessages,
  replaceMessage: store.replaceMessage,
  updateBot: store.updateBot,
  setWork: work.setWork,
  playMood: work.playMood,
  showToast: (text) => chatPanel.value?.showToast(text),
  reportFailure,
  holdKeys: keyHolds.hold
}));

const { send, retry, react, answerChoice, settleDraft, answerSecureForm, endVoiceConversation, cancelRequest, copyToClipboard, copyMessage, copyPicture } =
  useChatActions({ currentBot, picker, startGroup, store, work, reportFailure, notify });

// Cards a change in Details rewrote, such as a page deleted from the Library, in their bot's chat.
function showChanged({ botId, messages }) {
  for (const message of messages) store.replaceMessage(botId, message);
}

function reopen(botId) {
  router.replace({ query: chatQuery({ bot: botId }) });
}

// A conversation that's gone for this person: off the list, and if it was open, the first one opens.
function dropBot(botId) {
  const wasOpen = botId === currentBot.value?.id;
  bots.value = bots.value.filter((bot) => bot.id !== botId);
  if (wasOpen) reopen(firstOpenable());
}

// A chosen bot is named in the address, so it stays open whatever another bot's news does to the list
// (a new bot is chosen as it's made). Choosing the bot already shown adds no history entry: it's named
// in place, so Back never lands on the same chat, nor on an address that shows another bot.
function selectBot(id) {
  drawerOpen.value = false;
  // An open page closes too (D-74), so choosing the bot shown goes back to its chat.
  if (id === route.query.bot && !openPage.value) return;
  const query = chatQuery({ bot: id });
  if (id === currentBot.value.id) router.replace({ query });
  else router.push({ query });
}

// On a phone, a dot on the drawer's button says another bot has news (D-36 UX bar).
const otherNews = computed(() => bots.value.some((bot) => bot.unread && bot.id !== currentBot.value.id));

function selectIndex(index) {
  const id = visualOrder.value[index];
  if (id) selectBot(id);
}

const { runCommand } = useSidebarCommands({
  bots,
  sections,
  editingSectionId,
  store,
  currentBotId,
  mainBotId: () => mainBot.value?.id,
  firstBotId: firstOpenable,
  reopen,
  dropBot,
  open: { shortcuts: shortcutsOpen, about: aboutOpen, settings: openSettings },
  copy: copyToClipboard,
  reportFailure
});

const ACTIONS = {
  search: () => { paletteOpen.value = true; },
  newBot: openNewBot,
  newGroup: openGroupPicker,
  connectApps: () => { appsOpen.value = true; },
  skills: () => { appsOpen.value = true; },
  settings: () => openSettings("general"),
  shortcuts: () => { shortcutsOpen.value = !shortcutsOpen.value; },
  toggleCompact,
  toggleDetails: () => (detailsShown.value ? closeDetails() : showDetails()),
  focusComposer,
  find: () => { findOpen.value = true; },
  dictate: () => chatPanel.value?.dictationPress(),
  addSelection: () => chatPanel.value?.addSelection(),
  previousBot: () => selectIndex(currentIndex.value - 1),
  nextBot: () => selectIndex(currentIndex.value + 1)
};

const { foundFile, runPaletteEntry } = usePaletteRunner({ selectBot, showPage, store, chatPanel, openApp, openSettings, setTheme, actions: ACTIONS });

const overlays = [shortcutsOpen, settingsOpen, aboutOpen, paletteOpen, newBotOpen, appsOpen, explainerOpen, liveView];
const { positionHints, switchHighlightId } = useShellKeys({
  actions: ACTIONS,
  visualOrder,
  currentBotId,
  selectBot,
  selectIndex,
  paletteOpen,
  overlayOpen: () => overlays.some((overlay) => Boolean(overlay.value)) || keyHolds.held(),
  detailsDismissable: () => shellPreferences.detailsOpen && detailsShown.value && !findOpen.value && !liveView.value,
  closeDetails,
  releaseDictation: () => chatPanel.value?.dictationRelease()
});

// The home's Builder has its own face (builderBot.js).
watch(() => currentHomeEntry.value?.slug, () => loadBuilderBot(), { immediate: true });
</script>

<template>
  <div class="mb-shell">
    <div class="mb-shell__frame" :class="{ 'mb-shell__frame--phone': geometry.phone }">
      <div v-if="geometry.phone && drawerOpen" class="mb-shell__scrim" @click="drawerOpen = false" />
      <MercbotSidebar
        v-show="!geometry.phone || drawerOpen"
        :class="{ 'mb-shell__drawer': geometry.phone }"
        :model="sidebarModel"
        :sections="sections"
        :current-bot-id="currentBot.id"
        :compact="geometry.compact"
        :width="geometry.sidebarWidth"
        :hints="hints"
        :switch-highlight-id="switchHighlightId"
        :drafts="drafts"
        :moods="moodByBot"
        :hidden-expanded="shellPreferences.hiddenExpanded"
        :editing-section-id="editingSectionId"
        :display-name="displayName"
        :initials="initials"
        :picture="picture"
        @select="selectBot"
        @command="runCommand"
        @search="paletteOpen = true"
        @new-bot="openNewBot"
        @connect-apps="appsOpen = true"
        @resize="resizeSidebar"
      />
      <div v-if="geometry.phone && !shownPage" class="mb-shell__menu">
        <MercbotIconButton icon="$menu" label="Your bots" tone="surface" @click="drawerOpen = true" />
        <span v-if="otherNews" class="mb-shell__menu-dot" aria-hidden="true" />
      </div>
      <MercbotChatPanel
        ref="chatPanel"
        v-model:draft="chatDraft"
        :bot="currentBot"
        :messages="currentMessages"
        :has-older="!picker && Boolean(olderByBot[currentBot.id])"
        :load-older="loadOlder"
        :find-older="findOlder"
        :load-through="loadThrough"
        :page="shownPage"
        @open-page="showPage"
        @close-page="closePage"
        :status="status"
        :status-mood="statusMood"
        :status-bots="statusBots"
        :picker="picker ? { chosen: pickerBots, candidates: bots.filter((bot) => bot.kind !== 'group' && !bot.creating) } : null"
        @picker-change="picker = { botIds: $event }"
        @picker-close="picker = null"
        @picker-new-bot="openNewBot($event)"
        @picker-start="startGroup({})"
        :placeholder="placeholder"
        :unread-after="unreadAfterByBot[currentBot.id] || null"
        :column-width="geometry.columnWidth"
        :find-open="findOpen"
        :me="myId"
        @room-select="selectRoom"
        @room-create="createRoom"
        @room-rename="renameRoom"
        @undo-note="undoNote"
        @open-details="showDetails"
        @close-find="findOpen = false"
        @voice-ended="endVoiceConversation"
        @send="send"
        @failure="reportFailure($event?.message || 'That file didn\'t upload.', $event)"
        @answer="answerChoice"
        @take-over="takeOver"
        @use-computer="workOnFile"
        @secure-form="answerSecureForm"
        @settle-draft="settleDraft"
        @manage-rules="openSettings('permissions')"
        @settle-handover="settleHandover"
        @react="react"
        @copy="copyMessage"
        @copy-image="copyPicture"
        @retry="retry"
        @teach="teach"
        @open-skill="openSkill"
        @open-bot="selectBot"
        @cancel-request="cancelRequest"
        @choose="chooseName"
        @connect="explainConnect"
      >
        <template #notice>
          <component :is="part.component" v-for="(part, at) in noticeParts" :key="at" :pulse="currentMessages.length" @open-settings="openSettings" />
        </template>
      </MercbotChatPanel>
      <div v-if="detailsShown && !geometry.detailsVisible" class="mb-shell__scrim" @click="closeDetails" />
      <MercbotDetailsPanel
        v-if="detailsShown"
        :class="{ 'mb-shell__floating': !geometry.detailsVisible }"
        :width="geometry.detailsVisible ? geometry.detailsWidth : geometry.phone ? geometry.chatWidth : DETAILS_MIN"
        :bot="currentBot"
        :mood="moodByBot[currentBot.id] || 'idle'"
        @close="closeDetails"
        @open-page="showPage"
        @sharing="setSharing"
        @keep-out="keepOutOfNotebook"
        @resize="resizeDetails"
        @rename="runCommand({ name: 'renameBot', args: { botId: currentBot.id, name: $event } })"
        @label="runCommand({ name: 'setLabel', args: { botId: currentBot.id, label: $event } })"
        @failure="reportFailure('That didn\'t work. Try again.', $event)"
        @open-computer="openComputer"
        @edit-routine="editRoutine"
        :all-bots="bots"
        @add-member="runCommand({ name: 'addMember', args: { groupId: currentBot.id, botId: $event.id } })"
        @remove-member="runCommand({ name: 'removeMember', args: { groupId: currentBot.id, botId: $event.id } })"
        :me="myId"
        :display-name="displayName"
        @notify="notify"
        @messages="showChanged"
        @add-person="runCommand({ name: 'addPerson', args: { groupId: currentBot.id, userId: $event.id } })"
        @remove-person="runCommand({ name: 'removePerson', args: { groupId: currentBot.id, userId: $event.id } })"
      />
    </div>

    <MercbotViewViewer v-if="foundFile?.kind === 'view'" :slug="foundFile.path" :title="foundFile.name" @close="foundFile = null" />
    <MercbotFileViewer v-else-if="foundFile" :bot-id="foundFile.botId" :file="{ path: foundFile.path, name: ['chart', 'picture'].includes(foundFile.kind) ? `${foundFile.name}.png` : foundFile.name }" @close="foundFile = null" />
    <MercbotShortcutsDialog v-model="shortcutsOpen" />
    <component
      :is="part.component"
      v-for="(part, at) in dialogParts"
      :key="at"
      :bot="currentBot || null"
      @notify="notify"
      @failure="reportFailure"
    />
    <MercbotSettingsDialog
      v-model="settingsOpen"
      v-model:section="settingsSection"
      :theme="themePreference"
      :display-name="displayName"
      :initials="initials"
      @theme="setTheme"
      @failure="reportFailure('That didn\'t work. Try again.', $event)"
      @notify="notify"
      @connect="settingsOpen = false; openApp($event)"
    />
    <MercbotAboutDialog v-model="aboutOpen" @failure="reportFailure('Couldn\'t copy to the clipboard.', $event)" />
    <MercbotSearchPalette
      v-model="paletteOpen"
      :bots="bots.filter((bot) => !bot.creating)"
      :current-bot="currentBot"
      :settings-sections="EVERYONE_SECTIONS"
      :theme="themePreference"
      @run="runPaletteEntry"
    />
    <MercbotNewBotDialog v-model="newBotOpen" :busy="creating" :error="createError" :initial-name="newBotName" :bots="bots" @create="createBot" />
    <MercbotTemplatePreview :slug="templateSlug" @added="addedFromTemplate" @close="closeTemplate()" />
    <MercbotAppsModal v-model="appsOpen" :main-bot="mainBot" :skill-id="appsSkillId" :app-id="appsAppId" @failure="reportFailure('That didn\'t work. Try again.', $event)" />
    <MercbotConnectExplainer v-model="explainerOpen" :plugin="explainerPlugin" :bot-name="currentBot.name" @continue="continueConnect" />
    <MercbotLiveView
      v-if="liveView"
      :bot="liveBot"
      :start-in-control="liveView.inControl"
      :handover="Boolean(liveView.handover)"
      :teach="Boolean(liveView.teach)"
      @taught="finishTeaching"
      @failure="reportFailure('That didn\'t work. Try again.', $event)"
      @close="liveView = null"
      @done="settleHandover({ message: liveView.handover, outcome: 'done' })"
    />
  </div>
</template>

<style scoped src="./MercbotShell.css"></style>
