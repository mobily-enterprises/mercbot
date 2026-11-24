<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import iconUrl from "../../../favicon.svg";
import { accountApi } from "./accountApi.js";
import { useAppInstall } from "./appInstall.js";
import { chatTitle } from "./chatView.js";

// Mercbot as an app on this device (D-133): the one-time banner on phones offering to install it, the iPhone and iPad
// guide (Share → Add to Home Screen), the installed app's shortcuts (?go=new-chat), what another app shares into
// Mercbot (?go=share, kept by the service worker until a chat is chosen), the unread count on the app's icon, and the
// offer of notifications once, just after the person's first routine is set up: never on a first visit.
const props = defineProps({
  // The shell's New chat, the person's chats and their id.
  newChat: { type: Function, required: true },
  chats: { type: Array, required: true },
  me: { type: String, default: "" },
  selectChat: { type: Function, required: true },
  openChatId: { type: Function, required: true },
  // Puts what was shared into the open chat's message box: { text, files }.
  attach: { type: Function, required: true },
  // The open chat's messages, for the routine just set up.
  messages: { type: Array, default: () => [] }
});
const emit = defineEmits(["failure"]);
const route = useRoute();
const router = useRouter();
const app = useAppInstall();

const SHARED_CACHE = "mercbot-shared";
const OFFERED_KEY = "mercbot.notificationsOffered";
const FRESH_MS = 2 * 60 * 1000;
const BANNER_AFTER_MS = 8000;

// The banner: on a phone, once, a few seconds in, while Mercbot can be installed and nobody has answered it.
const banner = ref(false);
let bannerTimer = 0;
onMounted(() => {
  const phone = window.matchMedia("(pointer: coarse) and (max-width: 700px)").matches;
  if (!phone || app.bannerAnswered()) return;
  bannerTimer = window.setTimeout(() => {
    banner.value = app.canInstall.value;
  }, BANNER_AFTER_MS);
});
onBeforeUnmount(() => window.clearTimeout(bannerTimer));
function notNow() {
  banner.value = false;
  app.rememberBanner();
}
function installNow() {
  banner.value = false;
  app.install().catch((error) => emit("failure", error));
}
const guideOpen = computed({
  get: () => app.state.guideOpen,
  set: (value) => (value ? app.openGuide() : app.closeGuide())
});

// The shortcuts and sharing arrive as ?go=…; each is done once, then the address is left as it was.
const shared = ref(null);
const sharedFilter = ref("");
function dropGo() {
  const { go: _go, key: _key, ...rest } = route.query;
  router.replace({ query: rest });
}
watch(() => route.query.go, (go) => {
  if (!go) return;
  const key = typeof route.query.key === "string" ? route.query.key : "";
  dropGo();
  if (go === "new-chat") props.newChat();
  if (go === "share" && /^[a-z0-9]{4,40}$/u.test(key)) takeShared(key).catch((error) => emit("failure", error));
}, { immediate: true });

/** What the service worker kept for `key`: its words and files, read once and then removed. */
async function takeShared(key) {
  if (!("caches" in window)) return;
  const cache = await caches.open(SHARED_CACHE);
  const meta = await (await cache.match(`/shared/${key}/meta`))?.json();
  if (!meta) return;
  const files = [];
  for (const [index, file] of (meta.files || []).entries()) {
    const kept = await cache.match(`/shared/${key}/${index}`);
    if (kept) files.push(new File([await kept.blob()], file.name || `Shared ${index + 1}`, { type: file.type || "" }));
  }
  for (const request of await cache.keys()) {
    if (request.url.includes(`/shared/${key}/`)) await cache.delete(request);
  }
  const words = [meta.title, meta.text, meta.url].map((part) => String(part || "").trim()).filter(Boolean);
  // A link often comes in its text as well: it's said once.
  const text = [...new Set(words)].filter((part, _index, all) => !all.some((other) => other !== part && other.includes(part))).join("\n");
  if (!text && !files.length) return;
  sharedFilter.value = "";
  shared.value = { text, files };
}
const sharedSummary = computed(() => {
  if (!shared.value) return "";
  const count = shared.value.files.length;
  if (!count) return shared.value.text.length > 80 ? `${shared.value.text.slice(0, 79)}…` : shared.value.text;
  return count === 1 ? shared.value.files[0].name : `${count} files`;
});
const choices = computed(() => {
  const words = sharedFilter.value.trim().toLowerCase();
  return props.chats
    .filter((chat) => !chat.visiting && !chat.archivedAt)
    .map((chat) => ({ id: String(chat.id), title: chatTitle(chat, props.me) }))
    .filter((chat) => !words || chat.title.toLowerCase().includes(words))
    .slice(0, 50);
});
async function sendTo(chatId) {
  const payload = shared.value;
  shared.value = null;
  props.selectChat(chatId);
  // The chat opens, then its message box takes what was shared.
  for (let tries = 0; tries < 40 && props.openChatId() !== chatId; tries += 1) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  await nextTick();
  props.attach(payload);
}

// Notifications offered once, as a routine is set up here: it will have results to tell. Only where this device can
// have them and the person hasn't answered the browser's question yet.
const offer = ref(false);
const offerBusy = ref(false);
let offerKey = "";
function offered() {
  try {
    return Boolean(localStorage.getItem(OFFERED_KEY));
  } catch {
    return true;
  }
}
function rememberOffer() {
  try {
    localStorage.setItem(OFFERED_KEY, "answered");
  } catch {
    // Storage unavailable: the offer may come again with another routine.
  }
}
watch(() => props.messages.at(-1), async (latest) => {
  const made = latest?.kind === "event" && latest.body?.icon === "routine" && /^Created routine/u.test(latest.body?.text || "");
  if (!made || offer.value || offered() || !app.pushSupported.value || Notification.permission !== "default") return;
  if (Date.now() - new Date(latest.createdAt).getTime() > FRESH_MS) return;
  try {
    const push = await accountApi.push();
    if (!push.enabled) return;
    offerKey = push.publicKey;
    offer.value = true;
  } catch {
    // Without the server's answer there's nothing to offer; Settings has it too.
  }
});
function notNowNotifications() {
  offer.value = false;
  rememberOffer();
}
async function turnOnNotifications() {
  offerBusy.value = true;
  rememberOffer();
  try {
    await app.allowNotifications(offerKey);
  } catch (error) {
    emit("failure", error);
  } finally {
    offerBusy.value = false;
    offer.value = false;
  }
}

// The app's icon shows how many chats have news, where the device shows a count (installed, on Android and computers).
const unreadChats = computed(() => props.chats.filter((chat) => chat.unread && !chat.muted).length);
watch(unreadChats, (count) => {
  if (!("setAppBadge" in navigator)) return;
  (count ? navigator.setAppBadge(count) : navigator.clearAppBadge()).catch(() => {});
}, { immediate: true });
</script>

<template>
  <v-snackbar
    :model-value="banner"
    location="top"
    :timeout="-1"
    vertical
    class="mb-app-banner"
    @update:model-value="(value) => !value && notNow()"
  >
    <div class="mb-app-banner__body">
      <img :src="iconUrl" alt="" width="40" height="40" class="mb-app-banner__icon">
      <div>
        <p class="mb-app-banner__title">Install Mercbot</p>
        <p class="mb-app-banner__line">Open it from your home screen, full screen, with notifications.</p>
      </div>
    </div>
    <template #actions>
      <v-btn @click="notNow">Not now</v-btn>
      <v-btn @click="installNow">Install</v-btn>
    </template>
  </v-snackbar>

  <v-snackbar
    :model-value="offer"
    location="bottom"
    :timeout="-1"
    vertical
    class="mb-app-banner"
    @update:model-value="(value) => !value && notNowNotifications()"
  >
    <div class="mb-app-banner__body">
      <div>
        <p class="mb-app-banner__title">Get notified when it runs?</p>
        <p class="mb-app-banner__line">Mercbot tells you on this device when a routine has results or a bot needs you. Change it any time in Settings.</p>
      </div>
    </div>
    <template #actions>
      <v-btn @click="notNowNotifications">Not now</v-btn>
      <v-btn :loading="offerBusy" @click="turnOnNotifications">Turn on</v-btn>
    </template>
  </v-snackbar>

  <v-dialog v-model="guideOpen" width="360" scrim="scrim" :opacity="0.5">
    <div class="mb-app-guide">
      <button type="button" class="mb-app-guide__close" aria-label="Close" @click="guideOpen = false">
        <v-icon icon="$close" size="16" />
      </button>
      <img :src="iconUrl" alt="" width="56" height="56" class="mb-app-guide__icon">
      <p class="mb-app-guide__title">Add Mercbot to your Home Screen</p>
      <ol class="mb-app-guide__steps">
        <li><span>Tap <strong>Share</strong></span><v-icon icon="$iosShare" size="18" /><span>in Safari's toolbar.</span></li>
        <li><span>Choose <strong>Add to Home Screen</strong></span><v-icon icon="$add" size="18" /></li>
        <li><span>Tap <strong>Add</strong>, then open Mercbot from your Home Screen.</span></li>
      </ol>
      <p class="mb-app-guide__note">Notifications on an iPhone or iPad work once Mercbot is on your Home Screen.</p>
      <v-btn variant="tonal" color="primary" block @click="guideOpen = false">Done</v-btn>
    </div>
  </v-dialog>

  <v-dialog :model-value="Boolean(shared)" width="420" scrim="scrim" :opacity="0.5" @update:model-value="(value) => !value && (shared = null)">
    <div class="mb-app-share">
      <p class="mb-app-share__title">Send to a chat</p>
      <p class="mb-app-share__what">{{ sharedSummary }}</p>
      <v-text-field v-model="sharedFilter" density="compact" variant="outlined" hide-details placeholder="Find a chat" autofocus />
      <v-list density="compact" class="mb-app-share__list">
        <v-list-item v-for="chat in choices" :key="chat.id" min-height="40" @click="sendTo(chat.id)">
          <span class="mb-app-share__chat">{{ chat.title }}</span>
        </v-list-item>
        <p v-if="!choices.length" class="mb-app-share__empty">No chat by that name.</p>
      </v-list>
      <div class="mb-app-share__actions">
        <v-btn variant="text" @click="shared = null">Cancel</v-btn>
      </div>
    </div>
  </v-dialog>
</template>

<style scoped>
/* The banners are Material 3 snackbars: the inverse surface, its text and inverse-primary actions (JSKIT's defaults). */
.mb-app-banner__body {
  display: flex;
  align-items: center;
  gap: 12px;
  color: rgb(var(--v-theme-inverse-on-surface));
}

.mb-app-banner__icon,
.mb-app-guide__icon {
  flex: none;
  border-radius: 10px;
}

.mb-app-banner__title,
.mb-app-guide__title,
.mb-app-share__title {
  margin: 0;
  font-size: 16px;
  font-weight: 500;
}

.mb-app-banner__line {
  margin: 2px 0 0;
  font-size: 13px;
}

.mb-app-guide,
.mb-app-share {
  position: relative;
  padding: 24px;
  border-radius: 16px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface));
}

.mb-app-guide {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
}

.mb-app-guide__close {
  position: absolute;
  top: 10px;
  right: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 0;
  border-radius: 14px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}

.mb-app-guide__title {
  margin-top: 12px;
}

.mb-app-guide__steps {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 16px 0 12px;
  padding: 0 0 0 20px;
  font-size: 14px;
  text-align: left;
}

.mb-app-guide__steps li span + .v-icon,
.mb-app-guide__steps li .v-icon + span {
  margin-left: 6px;
}

.mb-app-guide__steps .v-icon {
  vertical-align: -3px;
  color: rgb(var(--v-theme-primary));
}

.mb-app-guide__note,
.mb-app-share__what,
.mb-app-share__empty {
  margin: 0 0 16px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-app-share__what {
  margin: 4px 0 12px;
  overflow-wrap: anywhere;
}

.mb-app-share__list {
  max-height: 320px;
  margin-top: 8px;
  overflow-y: auto;
  background: transparent;
}

.mb-app-share__chat {
  font-size: 14px;
}

.mb-app-share__empty {
  margin: 12px 16px;
}

.mb-app-share__actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>
