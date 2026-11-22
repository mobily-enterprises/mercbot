<script setup>
import { computed, provide, ref, shallowRef, watch } from "vue";
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
import MercbotNewChat from "./MercbotNewChat.vue";
import MercbotInviteDialog from "./MercbotInviteDialog.vue";
import MercbotSearchPalette from "./MercbotSearchPalette.vue";
import MercbotShortcutsDialog from "./MercbotShortcutsDialog.vue";
import MercbotAboutDialog from "./MercbotAboutDialog.vue";
import MercbotSettingsDialog from "./MercbotSettingsDialog.vue";
import { EVERYONE_SECTIONS } from "./settingsSections.js";
import MercbotSidebar from "./MercbotSidebar.vue";
import { buildSidebarModel, railOrder, toChatRow } from "./chatDirectory.js";
import { BOT_COLOURS } from "@/theme/palettes.js";
import { botFace, computerLine, isDirect, readersLine } from "./chatView.js";
import { chatsApi } from "./chatsApi.js";
import { followOpenChat } from "./chatPlace.js";
import { composerPlaceholder } from "./composerPlaceholder.js";
import { currentHome } from "./homeApi.js";
import { useHomes } from "./homesApi.js";
import { DETAILS_MIN } from "./shellGeometry.js";
import { shellPreferences } from "./shellPreferences.js";
import { MERCBOT_INITIALS_KEY, uploadedPicture } from "./shellInitials.js";
import { MERCBOT_CHAT_KEY, checkExtensions, createKeyHolds } from "./shellChat.js";
import MercbotIconButton from "./MercbotIconButton.vue";
import { useChatEvents } from "./useChatEvents.js";
import { useChatMessages } from "./useChatMessages.js";
import { useChatWork } from "./useChatWork.js";
import { useChatActions } from "./useChatActions.js";
import { useConnectApps } from "./useConnectApps.js";
import { useDrafts } from "./useDrafts.js";
import { useNewChat } from "./useNewChat.js";
import { useLiveView } from "./useLiveView.js";
import { useNewBot } from "./useNewBot.js";
import { useOnboarding } from "./useOnboarding.js";
import { useOpenPage } from "./useOpenPage.js";
import { usePaletteRunner } from "./usePaletteRunner.js";
import { useShellAddress } from "./useShellAddress.js";
import { useShellDialogs } from "./useShellDialogs.js";
import { useShellKeys } from "./useShellKeys.js";
import { useShellLayout } from "./useShellLayout.js";
import { useShellTheme } from "./useShellTheme.js";
import { useSidebarCommands } from "./useSidebarCommands.js";
import { useTeam } from "./useTeam.js";

// The signed-in Mercbot shell (D-8, D-112): the sidebar's Rooms, People and Bots (D3), the open chat, New room and
// Invite, and the details beside them. The composables beside it hold each part; the shell joins them and opens the
// dialogs.
const props = defineProps({
  initialChats: { type: Array, required: true },
  initialSections: { type: Array, default: () => [] }
});

const chats = ref(props.initialChats.map(toChatRow));
const sections = ref(props.initialSections);
const editingSectionId = ref("");
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { context: placementContext } = useWebPlacementContext();
const me = computed(() => String(placementContext.value?.user?.id || ""));
const { current: currentHomeEntry, manages } = useHomes();
const homeName = computed(() => currentHomeEntry.value?.name || "this home");
const errorRuntime = useShellWebErrorRuntime();

// The parts a copy built on Mercbot adds to the shell (extensions.js shellParts): above the open chat's composer
// (place "notice"), or beside the shell's dialogs. A copy written for a shape that's gone stops here, saying so.
checkExtensions(extensions);
const noticeParts = extensions.shellParts.filter((part) => part.place === "notice");
const dialogParts = extensions.shellParts.filter((part) => part.place !== "notice");

function reportFailure(message, cause) {
  // Work the copy refused says why (accountApi.js refusedWork), as does anything written to an archived bot (D-108).
  const said = refusedWork(cause) || cause?.code === "bots_bot_archived" ? cause.message || message : message;
  errorRuntime.report({ source: "mercbot.chat", message: said, cause, intent: "action-feedback", severity: "error" });
}

function notify(message) {
  errorRuntime.report({ source: "mercbot.chat", message, intent: "action-feedback", severity: "success" });
}

const team = useTeam({ homeSlug: currentHome, reportFailure });
team.load();

// The home's public rooms the person isn't in, listed faded: read as the shell opens, and again on any chat's news.
const publicRooms = ref([]);
async function loadPublicRooms() {
  try {
    publicRooms.value = (await chatsApi.publicRooms()).chats.map(toChatRow);
  } catch {
    // The faded rooms stay as they were until the next news.
  }
}
loadPublicRooms();

// People's +, when a copy built on Mercbot gives one (extensions.js peopleActions): asked once as the sidebar opens.
const peopleActions = shallowRef([]);
Promise.all(extensions.peopleActions.map((action) => (action.visible ? action.visible().catch(() => false) : true)))
  .then((answers) => { peopleActions.value = extensions.peopleActions.filter((_action, at) => answers[at]); });

// Rooms, People and Bots folded, per device and home; each section's "N more" opened, for this visit.
const folded = computed(() => shellPreferences.folded[currentHome()] || {});
const sidebarMore = ref({});

const { geometry, detailsShown, showDetails, closeDetails, drawerOpen, toggleCompact, resizeSidebar, resizeDetails } = useShellLayout();
const sidebarModel = computed(() => buildSidebarModel({
  chats: chats.value,
  sections: sections.value,
  publicRooms: publicRooms.value,
  people: team.people.value || [],
  bots: team.bots.value || [],
  me: me.value,
  // The chat shown, as the address names it (the chat shown is itself read from this list's order).
  openId: addressedChatId.value || unnamedChatId.value,
  folded: folded.value,
  more: sidebarMore.value,
  hiddenExpanded: shellPreferences.hiddenExpanded,
  archivedExpanded: shellPreferences.archivedExpanded
}));
const visualOrder = computed(() => (geometry.value.compact ? railOrder(sidebarModel.value) : sidebarModel.value.visualOrder));

// The open chat, by id; `currentChat` below says which one it is.
const currentChatId = () => currentChat.value?.id || "";
const store = useChatMessages({ chats, currentChatId });
const { messagesByChat, olderByChat, markSeen } = store;
const work = useChatWork({ store });
const { workByChat, speakersByChat, moodByChat } = work;

const openable = (id) => (id ? chats.value.find((chat) => chat.id === id) || null : null);
const firstOpenable = () => visualOrder.value.find(openable) || "";
const firstChatQuery = () => (firstOpenable() ? { chat: firstOpenable() } : {});

/** The person's direct chat with a bot (made the first time), opened: a bot's [Message], and a link naming a bot. */
async function openDirect(botId, replace = false) {
  try {
    const { chat } = await chatsApi.direct(botId);
    // One the list doesn't have yet is this page's own, so a list read already under way keeps it (mergeChats).
    if (store.knowsChat(String(chat.id))) store.updateChat(chat);
    else store.addChat(chat);
    drawerOpen.value = false;
    closeNewChat();
    await showChat(String(chat.id), { replace });
  } catch (error) {
    reportFailure(error?.code === "bots_bot_archived" ? error.message : "That chat didn't open. Try again.", error);
  }
}

const { addressedChatId, memberKey, chatQuery, showChat, showMember } = useShellAddress({
  route,
  router,
  openDirect,
  showDetails,
  shownChatId: currentChatId
});

// The chat shown: the one the address names (a public room the person isn't in too), or with none named the first in
// the list, which stays open whatever another chat's news does to the list (Back to such an address shows it again).
// An empty list has none (D4).
const unnamedChatId = ref("");
const currentChat = computed(() => openable(addressedChatId.value) || openable(unnamedChatId.value) || openable(firstOpenable()));
watch(currentChatId, (chatId) => {
  if (chatId && !openable(addressedChatId.value)) unnamedChatId.value = chatId;
}, { immediate: true });
// A chat's files and computer follow the open chat (chatPlace.js).
followOpenChat(currentChatId);

// A chat the address names that's not on the list (a public room the person isn't in, from Rooms, search or a link):
// read once, and shown. One the person can't open is a 404 (a private chat they're not in), and the first chat opens.
watch(addressedChatId, async (chatId) => {
  if (!chatId || openable(chatId)) return;
  try {
    store.updateChat((await chatsApi.get(chatId)).chat);
  } catch (error) {
    reportFailure(error?.status === 404 ? "That chat isn't there, or it's private." : "That chat didn't open. Try again.", error);
    router.replace({ query: firstChatQuery() });
  }
}, { immediate: true });

const { drafts, currentDraft } = useDrafts({ currentChatId });
const currentMessages = computed(() => (currentChat.value ? messagesByChat.value[currentChat.value.id] || [] : []));
const botName = (botId) => team.botById(botId)?.name || "";
const { openPage, showPage, closePage } = useOpenPage({ route, router, messages: currentMessages, botName, chatQuery, currentChatId });

// Invite, from a room's header, and by itself right after a private room is made.
const inviteOpen = ref(false);
const { newChat, starting, openNewChat, continueWithOthers, closeNewChat, changeNewChat, startNewChat } =
  useNewChat({ currentChat, currentDraft, store, showChat, onPrivate: () => { inviteOpen.value = true; }, reportFailure });
// The composer takes the colour of a chat's one bot, else neutral black.
const accentColor = computed(() => {
  const bots = currentChat.value?.bots || [];
  return bots.length === 1 ? bots[0].color : BOT_COLOURS.Black;
});

// The page shown in place of the chat; on a phone it has the screen, with its own Close.
const shownPage = computed(() => openPage.value);
const status = computed(() => (currentChat.value ? workByChat.value[currentChat.value.id] || onboardingTiming.value?.status || "" : ""));
// The status line shows the bots that are working in this chat.
const statusBots = computed(() => (speakersByChat.value[currentChatId()] || [])
  .map((botId) => currentChat.value?.bots.find((bot) => String(bot.botId) === String(botId)))
  .filter(Boolean)
  .map(botFace));
const statusMood = computed(() => {
  const mood = moodByChat.value[currentChatId()];
  return mood === "thinking" || mood === "attention" ? mood : "working";
});
// The composer's line says who can read what's written (plan 4.4, 8), unless an open card asks for something.
const placeholder = computed(() => {
  if (!currentChat.value) return "";
  return composerPlaceholder({ messages: currentMessages.value, me: me.value }) ||
    readersLine(currentChat.value, { me: me.value, homeName: homeName.value, short: geometry.value.phone });
});

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

// A person's own face in a chat shows their initials.
provide(MERCBOT_INITIALS_KEY, initials);

const chatPanel = ref(null);
const { shortcutsOpen, settingsOpen, settingsSection, openSettings, aboutOpen, findOpen } = useShellDialogs({ route, router });
// The open chat's page before its oldest loaded message, as the person scrolls up.
const loadOlder = () => store.loadOlder(currentChatId()).catch((error) => reportFailure("Older messages didn't load.", error));
// Find in chat counts the matches in the pages not loaded yet on the server, and brings the pages down to one only
// when the person goes to it.
const findOlder = (text) => store.findOlder(currentChatId(), text);
const loadThrough = (messageId) => store.loadThrough(currentChatId(), messageId)
  .catch((error) => reportFailure("Older messages didn't load.", error));

const { themePreference, setTheme } = useShellTheme({ accentColor, reportFailure });

// Opening a chat with unread messages puts the "new" divider above the first of them. It stays for this visit and is
// gone the next time the chat is opened.
const unreadAfterByChat = ref({});
watch(currentChatId, (chatId) => {
  const chat = currentChat.value;
  if (!chat) return;
  unreadAfterByChat.value = { ...unreadAfterByChat.value, [chatId]: chat.unread ? chat.readUpTo || "0" : null };
  if (chat.unread) markSeen(chatId);
}, { immediate: true });

/** A chat gone for this person (left, deleted, or one they can no longer open): if it was open, the first one opens. */
function dropChat(chatId) {
  const wasOpen = chatId === currentChatId();
  store.dropChat(chatId);
  if (wasOpen) router.replace({ query: firstChatQuery() });
}
const { computerNews } = useChatEvents({
  store,
  work,
  team,
  onDropped: (chatId) => {
    if (chatId === addressedChatId.value) router.replace({ query: firstChatQuery() });
  },
  onComputer,
  onRooms: loadPublicRooms
});

// Someone else took over the computer this person had open in control: the live view goes back to watching, and says so.
function onComputer(news) {
  if (!computerChanged(news, me.value)) return;
  const who = team.personById(news.control)?.name?.split(/\s+/u)[0] || "Someone";
  notify(`${who} took over ${liveBot.value?.name || "the bot"}'s computer.`);
}

function focusComposer() {
  chatPanel.value?.focusComposer();
}

// Edit goes through the chat: the composer gets a request naming the routine, in the chat it's in.
async function editRoutine(routine) {
  if (routine.chatId && String(routine.chatId) !== currentChatId()) await showChat(String(routine.chatId));
  currentDraft.value = `Edit your routine "${routine.name}": `;
  focusComposer();
}

const { onboardingTiming, chooseName } = useOnboarding({ currentChat, store, focusComposer, reportFailure });

const {
  appsOpen, appsSkillId, appsAppId, appsPage, explainerOpen, explainerPlugin,
  openApp, openSkill, openSkills, explainConnect, continueConnect
} = useConnectApps({ reportFailure, currentChat });

/** A bot's face as a chat has it, else as the home's bots have it. */
function chatBotFace(chatId, botId) {
  const member = openable(String(chatId))?.bots.find((bot) => String(bot.botId) === String(botId));
  if (member) return botFace(member);
  const bot = team.botById(botId);
  return bot ? { id: bot.id, name: bot.name, color: bot.color, shape: bot.shape } : null;
}
const { liveView, liveBot, openComputer, takeOver, takeOverFor, handBack, workOnFile, teach, finishTeaching, settleHandover, closeLive, computerChanged } =
  useLiveView({ store, work, chatBotFace, reportFailure });
/** A chat's computer opened from its details: to watch, or taken over (D16). */
const openLive = (target) => (target.control ? takeOver(target) : openComputer(target));
const liveWhose = computed(() => (liveView.value ? computerLine(openable(liveView.value.chatId), homeName.value) : ""));
// Who signs in to an app from a connect card: the chat's one bot, else "your bot".
const explainerBotName = computed(() => (currentChat.value?.bots.length === 1 ? currentChat.value.bots[0].name : "your bot"));

const paletteOpen = ref(false);
const { newBotOpen, creating, createError, newBotTemplate, newBotScreen, openNewBot, openTeams, createBot, addTeam, addBots } = useNewBot({
  team,
  openDirect,
  // In the chat panel's own toast, or the shell's while no chat is open.
  notify: (text) => setTimeout(() => (chatPanel.value ? chatPanel.value.showToast(text) : notify(text)), 600)
});

// A bot from a template or a shared link (D-98): ?template=<code> opens Add bots with it chosen, and leaves the address.
const templateSlug = computed(() => (route.query.template ? String(route.query.template) : ""));
watch(templateSlug, (slug) => {
  if (!slug) return;
  openNewBot(slug);
  const { template: _shown, ...rest } = route.query;
  router.replace({ query: rest });
}, { immediate: true });

// The chat, for the parts a copy built on Mercbot adds beside the shell's dialogs, to a bot's card and to the timeline
// (shellChat.js). A part's dialog keeps the keyboard shortcuts away while it's open, as the shell's own dialogs do.
const keyHolds = createKeyHolds();
provide(MERCBOT_CHAT_KEY, Object.freeze({
  appendMessages: store.appendMessages,
  replaceMessage: store.replaceMessage,
  updateChat: store.updateChat,
  openChat: (chatId) => showChat(String(chatId)),
  setWork: work.setWork,
  playMood: work.playMood,
  showToast: (text) => chatPanel.value?.showToast(text),
  reportFailure,
  holdKeys: keyHolds.hold
}));

// The welcome chat's "what is this home for?" opens Add bots on Describe what you need ("start") or on its teams.
const openAddBots = (screen) => (screen === "teams" ? openTeams() : openNewBot("", "start"));
const { send, retry, react, answerChoice, settleDraft, answerSecureForm, endVoiceConversation, discuss, cancelRequest, copyToClipboard, copyMessage, copyPicture } =
  useChatActions({ currentChat, store, work, reportFailure, notify, openAddBots, me: () => me.value });

// Cards a change in a card rewrote, such as a page deleted from a bot's Library, in their chat.
function showChanged({ chatId, messages }) {
  if (!chatId) return;
  for (const message of messages) store.replaceMessage(String(chatId), message);
}

/** The person's private chat with another person (made the first time), opened: their row in People, their [Message]. */
async function openPerson(userId) {
  try {
    const { chat } = await chatsApi.personDirect(userId);
    if (store.knowsChat(String(chat.id))) store.updateChat(chat);
    else store.addChat(chat);
    drawerOpen.value = false;
    await showChat(String(chat.id));
  } catch (error) {
    reportFailure(error?.status === 404 && error.message ? error.message : "That chat didn't open. Try again.", error);
  }
}

// A chosen chat is named in the address, so it stays open whatever another chat's news does to the list. Choosing the
// chat already shown adds no history entry. A person or a bot with no chat with the person yet ("person:<id>",
// "bot:<id>") has it made and opened.
function selectChat(id) {
  drawerOpen.value = false;
  if (id.startsWith("person:")) return openPerson(id.slice(7));
  if (id.startsWith("bot:")) return openDirect(id.slice(4));
  // An open page closes too (D-74), and so does a member's card, so choosing the chat shown goes back to it.
  if (id === route.query.chat && !openPage.value && !memberKey.value) return;
  showChat(id);
}

// On a phone, a dot on the drawer's button says another chat has news (D-36 UX bar).
const otherNews = computed(() => chats.value.some((chat) => chat.unread && !chat.archivedAt && !chat.visiting && chat.id !== currentChatId()));

function selectIndex(index) {
  const id = visualOrder.value[index];
  if (id) selectChat(id);
}

const { runCommand } = useSidebarCommands({
  sections,
  editingSectionId,
  store,
  team,
  dropChat,
  open: { shortcuts: shortcutsOpen, about: aboutOpen, settings: openSettings },
  copy: copyToClipboard,
  reportFailure,
  homeName: () => homeName.value,
  homeSlug: currentHome,
  more: sidebarMore
});

// Invite's picks: each person or bot into the open room, one by one.
function invite(picks) {
  const chatId = currentChatId();
  for (const { kind, id } of picks) {
    if (kind === "person") runCommand({ name: "addPerson", args: { chatId, userId: id } });
    else runCommand({ name: "addBot", args: { chatId, botId: id } });
  }
}

// A member's card opens in Details beside the chat, again if it's the one the address names already (a closed card
// tapped again).
function openMember(key) {
  showMember(key);
  showDetails();
}

// New room (D15): Public unless the person picks Private.
function beginNewChat() {
  drawerOpen.value = false;
  openNewChat();
}

// [Message] (plan 4.2): a bot's opens the person's direct chat with it; a person's, the private chat of just the two of
// them, made the first time.
function messageMember(member) {
  return member.kind === "bot" ? openDirect(String(member.bot.id)) : openPerson(String(member.person.id));
}

// The details beside what's shown: the card of a member the address names (from Chat details, an archived bot in Bots,
// the palette); in a direct chat, its bot's card with this chat's computer, or the other person's card; in a room,
// Chat details.
function memberOf(key) {
  const [kind, id] = String(key || "").split(":");
  const bot = kind === "bot" ? team.botById(id) : null;
  if (bot) return { kind: "bot", bot };
  const person = kind === "person" ? team.personById(id) : null;
  return person ? { kind: "person", person } : null;
}
const details = computed(() => {
  const member = memberOf(memberKey.value);
  if (member) return { member, chat: null };
  const chat = currentChat.value;
  if (!chat) return null;
  const bot = isDirect(chat) ? team.botById(chat.directBotId) : null;
  if (bot) return { member: { kind: "bot", bot }, chat };
  const person = chat.directPerson ? team.personById(chat.directPerson.userId) : null;
  return person ? { member: { kind: "person", person }, chat } : { member: null, chat };
});

const ACTIONS = {
  search: () => { paletteOpen.value = true; },
  newBot: openNewBot,
  newChat: () => beginNewChat(),
  connectApps: () => { appsOpen.value = true; },
  skills: openSkills,
  settings: () => openSettings("general"),
  shortcuts: () => { shortcutsOpen.value = !shortcutsOpen.value; },
  toggleCompact,
  toggleDetails: () => (detailsShown.value ? closeDetails() : showDetails()),
  focusComposer,
  find: () => { findOpen.value = true; },
  dictate: () => chatPanel.value?.dictationPress(),
  addSelection: () => chatPanel.value?.addSelection(),
  previousChat: () => selectIndex(visualOrder.value.indexOf(currentChatId()) - 1),
  nextChat: () => selectIndex(visualOrder.value.indexOf(currentChatId()) + 1)
};

const { foundFile, runPaletteEntry } = usePaletteRunner({
  selectChat,
  openDirect,
  openMember,
  showPage,
  store,
  chatPanel,
  openApp,
  openSettings,
  setTheme,
  showDetails,
  actions: ACTIONS
});

const overlays = [shortcutsOpen, settingsOpen, aboutOpen, paletteOpen, newBotOpen, appsOpen, explainerOpen, liveView, newChat, inviteOpen];
const { positionHints, switchHighlightId } = useShellKeys({
  actions: ACTIONS,
  visualOrder,
  currentChatId,
  selectChat,
  selectIndex,
  paletteOpen,
  overlayOpen: () => overlays.some((overlay) => Boolean(overlay.value)) || keyHolds.held(),
  detailsDismissable: () => shellPreferences.detailsOpen && detailsShown.value && !findOpen.value && !liveView.value,
  closeDetails,
  releaseDictation: () => chatPanel.value?.dictationRelease()
});
const hints = computed(() => (positionHints.value
  ? Object.fromEntries(visualOrder.value.slice(0, 9).map((id, index) => [id, index + 1]))
  : {}));

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
        :current-chat-id="currentChat ? currentChat.id : ''"
        :folded="folded"
        :people-actions="peopleActions"
        :home-name="homeName"
        :me="me"
        :manages="manages"
        :compact="geometry.compact"
        :width="geometry.sidebarWidth"
        :hints="hints"
        :switch-highlight-id="switchHighlightId"
        :drafts="drafts"
        :moods="moodByChat"
        :hidden-expanded="shellPreferences.hiddenExpanded"
        :archived-expanded="shellPreferences.archivedExpanded"
        :editing-section-id="editingSectionId"
        :display-name="displayName"
        :initials="initials"
        :picture="picture"
        @select="selectChat"
        @command="runCommand"
        @search="paletteOpen = true"
        @new-chat="beginNewChat()"
        @new-bot="openNewBot()"
        @open-member="openMember"
        @connect-apps="appsOpen = true"
        @skills="openSkills"
        @resize="resizeSidebar"
      />
      <!-- On a phone a chat's own header has the drawer's button (plan 4.6); an empty list shows this one. -->
      <div v-if="geometry.phone && !shownPage && !currentChat" class="mb-shell__menu">
        <MercbotIconButton icon="$menu" label="Your chats" tone="surface" @click="drawerOpen = true" />
        <span v-if="otherNews" class="mb-shell__menu-dot" aria-hidden="true" />
      </div>
      <MercbotChatPanel
        ref="chatPanel"
        v-model:draft="currentDraft"
        :chat="currentChat"
        :messages="currentMessages"
        :people="team.people.value"
        :team-bots="team.bots.value || []"
        :home-name="homeName"
        :manages="manages"
        :phone="geometry.phone"
        :other-news="otherNews"
        :has-older="Boolean(currentChat && olderByChat[currentChat.id])"
        :load-older="loadOlder"
        :find-older="findOlder"
        :load-through="loadThrough"
        :page="shownPage"
        :status="status"
        :status-mood="statusMood"
        :status-bots="statusBots"
        :placeholder="placeholder"
        :unread-after="currentChat ? unreadAfterByChat[currentChat.id] || null : null"
        :column-width="geometry.columnWidth"
        :find-open="findOpen"
        :me="me"
        @open-page="showPage"
        @close-page="closePage"
        @new-chat="beginNewChat()"
        @new-bot="openNewBot()"
        @menu="drawerOpen = true"
        @unarchive-bot="runCommand({ name: 'unarchiveBot', args: { botId: $event } })"
        @unarchive-chat="runCommand({ name: 'unarchiveChat', args: { chatId: currentChat.id } })"
        @invite="inviteOpen = true"
        @continue-with-others="continueWithOthers(currentChat)"
        @open-direct="openDirect"
        @open-details="showDetails"
        @close-find="findOpen = false"
        @voice-ended="endVoiceConversation"
        @send="send"
        @failure="reportFailure($event?.message || 'That file didn\'t upload.', $event)"
        @answer="answerChoice"
        @take-over="takeOverFor({ ...$event, chatId: currentChat.id })"
        @use-computer="workOnFile({ ...$event, chatId: currentChat.id })"
        @secure-form="answerSecureForm"
        @settle-draft="settleDraft"
        @manage-rules="openSettings('permissions')"
        @settle-handover="settleHandover({ ...$event, chatId: currentChat.id })"
        @react="react"
        @copy="copyMessage"
        @copy-image="copyPicture"
        @retry="retry"
        @teach="teach({ ...$event, chatId: currentChat.id })"
        @open-skill="openSkill"
        @cancel-request="cancelRequest"
        @discuss="discuss"
        @choose="chooseName"
        @connect="explainConnect"
      >
        <template #notice>
          <component :is="part.component" v-for="(part, at) in noticeParts" :key="at" :pulse="currentMessages.length" @open-settings="openSettings" />
        </template>
      </MercbotChatPanel>
      <div v-if="detailsShown && details && !geometry.detailsVisible" class="mb-shell__scrim" @click="closeDetails" />
      <MercbotDetailsPanel
        v-if="detailsShown && details"
        :class="{ 'mb-shell__floating': !geometry.detailsVisible }"
        :width="geometry.detailsVisible ? geometry.detailsWidth : geometry.phone ? geometry.chatWidth : DETAILS_MIN"
        :member="details.member"
        :chat="details.chat"
        :chats="chats"
        :me="me"
        :home-name="homeName"
        :manages="manages"
        :team-bots="team.bots.value || []"
        :computer-news="computerNews"
        :mood="details.chat ? moodByChat[details.chat.id] || 'idle' : 'idle'"
        @close="closeDetails"
        @resize="resizeDetails"
        @open-page="showPage"
        @open-chat="selectChat"
        @open-member="openMember"
        @message="messageMember"
        @command="runCommand"
        @changed="team.updateBot($event)"
        @failure="reportFailure('That didn\'t work. Try again.', $event)"
        @notify="notify"
        @messages="showChanged"
        @edit-routine="editRoutine"
        @open-computer="openLive"
      />
    </div>

    <MercbotViewViewer v-if="foundFile?.kind === 'view'" :slug="foundFile.path" :title="foundFile.name" @close="foundFile = null" />
    <MercbotFileViewer
      v-else-if="foundFile"
      :bot-id="foundFile.botId"
      :chat-id="foundFile.chatId || null"
      :file="{ path: foundFile.path, name: ['chart', 'picture'].includes(foundFile.kind) ? `${foundFile.name}.png` : foundFile.name }"
      @close="foundFile = null"
    />
    <MercbotShortcutsDialog v-model="shortcutsOpen" />
    <component
      :is="part.component"
      v-for="(part, at) in dialogParts"
      :key="at"
      :chat="currentChat"
      @notify="notify"
      @failure="reportFailure"
    />
    <MercbotSettingsDialog
      v-model="settingsOpen"
      v-model:section="settingsSection"
      :theme="themePreference"
      :display-name="displayName"
      :initials="initials"
      :me="me"
      :manages="manages"
      :home-name="homeName"
      @theme="setTheme"
      @failure="reportFailure('That didn\'t work. Try again.', $event)"
      @notify="notify"
      @connect="settingsOpen = false; openApp($event)"
      @bots-changed="team.loadBots()"
    />
    <MercbotAboutDialog v-model="aboutOpen" @failure="reportFailure('Couldn\'t copy to the clipboard.', $event)" />
    <MercbotSearchPalette
      v-model="paletteOpen"
      :chats="chats.filter((chat) => !chat.visiting)"
      :bots="team.activeBots.value"
      :people="team.people.value || []"
      :me="me"
      :settings-sections="EVERYONE_SECTIONS"
      :theme="themePreference"
      @run="runPaletteEntry"
    />
    <MercbotNewChat
      :choice="newChat"
      :bots="team.activeBots.value"
      :home-name="homeName"
      :starting="starting"
      @change="changeNewChat"
      @close="closeNewChat"
      @start="startNewChat"
    />
    <MercbotInviteDialog
      v-model="inviteOpen"
      :chat="currentChat"
      :people="team.people.value || []"
      :bots="team.bots.value || []"
      :me="me"
      :loading="team.people.value === null || team.bots.value === null"
      @add="invite"
    />
    <MercbotNewBotDialog
      v-model="newBotOpen"
      :busy="creating"
      :error="createError"
      :template-slug="newBotTemplate"
      :screen="newBotScreen"
      :bots="team.bots.value || []"
      @create="createBot"
      @add-team="addTeam"
      @add-bots="addBots"
    />
    <MercbotAppsModal v-model="appsOpen" :main-bot="team.mainBot.value" :skill-id="appsSkillId" :app-id="appsAppId" :start-page="appsPage" @failure="reportFailure('That didn\'t work. Try again.', $event)" />
    <MercbotConnectExplainer
      v-model="explainerOpen"
      :plugin="explainerPlugin"
      :bot-name="explainerBotName"
      :home-name="homeName"
      @continue="continueConnect"
    />
    <MercbotLiveView
      v-if="liveView && liveBot"
      :bot="liveBot"
      :chat-id="liveView.chatId"
      :whose="liveWhose"
      :in-control="liveView.inControl"
      :handover="Boolean(liveView.handover)"
      :teach="Boolean(liveView.teach)"
      @taught="finishTeaching"
      @failure="reportFailure('That didn\'t work. Try again.', $event)"
      @close="closeLive"
      @take-over="takeOver({ botId: liveView.botId, chatId: liveView.chatId })"
      @hand-back="handBack()"
      @done="settleHandover({ message: liveView.handover, outcome: 'done' })"
    />
  </div>
</template>

<style scoped src="./MercbotShell.css"></style>
