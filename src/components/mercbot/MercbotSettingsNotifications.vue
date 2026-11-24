<script setup>
import { computed, onMounted, ref } from "vue";
import MercbotSettingsSelect from "./MercbotSettingsSelect.vue";
import MercbotSwitch from "./MercbotSwitch.vue";
import { accountApi, saidByServer } from "./accountApi.js";
import { notificationsOutcome, useAppInstall } from "./appInstall.js";
import { currentTimeZone } from "./shellPreferences.js";

// Settings → General → Notifications (D-133): this device allowed or not, which news notifies the person (a routine's
// or watch's result, a bot waiting for them, messages and mentions), whether the message's text shows, quiet hours,
// the devices that receive them, and a test notification. Muted chats never notify. Each change saves at once.
const emit = defineEmits(["notify"]);
const app = useAppInstall();

// What the server keeps (GET /push), and this browser's own subscription address.
const push = ref(null);
const loadFailed = ref(false);
const thisEndpoint = ref("");
const busy = ref(false);
// What went wrong last, in the person's words, under the card.
const problem = ref("");
const permission = ref(globalThis.Notification ? globalThis.Notification.permission : "unsupported");

async function load() {
  loadFailed.value = false;
  try {
    push.value = await accountApi.push();
    thisEndpoint.value = (await app.currentSubscription())?.endpoint || "";
  } catch {
    loadFailed.value = true;
  }
}
onMounted(load);

const thisDevice = computed(() => push.value?.devices.find((device) => device.endpoint === thisEndpoint.value) || null);
// Why this device can't have notifications, in the person's words, or "" when it can.
const blocker = computed(() => {
  if (!push.value) return "";
  if (!push.value.enabled) return "Notifications aren't set up on this copy of Mercbot.";
  if (app.needsInstallForPush.value) return "On an iPhone or iPad, notifications work once Mercbot is on your Home Screen.";
  if (!app.pushSupported.value) return "This browser doesn't show notifications.";
  if (permission.value === "denied") return "Notifications are blocked for Mercbot in this browser. Allow them in its site settings, then come back.";
  return "";
});

const allowed = computed({
  get: () => Boolean(thisDevice.value),
  set: (on) => (on ? allow() : stop())
});

async function allow() {
  busy.value = true;
  problem.value = "";
  try {
    const outcome = await app.allowNotifications(push.value.publicKey);
    permission.value = Notification.permission;
    if (outcome === "allowed") emit("notify", "Notifications are on for this device");
    problem.value = notificationsOutcome(outcome);
    await load();
  } catch (error) {
    problem.value = saidByServer(error, "Notifications couldn't be turned on. Try again.");
  } finally {
    busy.value = false;
  }
}

async function stop() {
  busy.value = true;
  problem.value = "";
  try {
    await app.stopNotifications(thisDevice.value?.id);
    await load();
  } catch (error) {
    problem.value = saidByServer(error, "Notifications couldn't be turned off. Try again.");
  } finally {
    busy.value = false;
  }
}

async function test() {
  try {
    if (await app.testNotification()) emit("notify", "Test notification sent");
    else problem.value = "Turn notifications on for this device first.";
  } catch {
    problem.value = "The test notification didn't show. Try again.";
  }
}

async function forget(device) {
  try {
    if (device.id === thisDevice.value?.id) await app.stopNotifications(device.id);
    else push.value = await accountApi.removePushDevice(device.id);
    await load();
  } catch (error) {
    problem.value = saidByServer(error, "That device couldn't be removed. Try again.");
  }
}

/** Saves a change to the settings, showing it at once and going back if the server refuses it. */
async function save(changes) {
  const before = push.value.settings;
  push.value = { ...push.value, settings: { ...before, ...changes } };
  try {
    push.value = await accountApi.savePushSettings(changes);
  } catch (error) {
    push.value = { ...push.value, settings: before };
    problem.value = saidByServer(error, "That setting couldn't be saved. Try again.");
  }
}
const setting = (key) => computed({
  get: () => Boolean(push.value?.settings[key]),
  set: (value) => save({ [key]: value })
});
const results = setting("results");
const waiting = setting("waiting");
const messages = setting("messages");
const showText = setting("showText");

// Quiet hours: on with 22:00 to 07:00 unless changed, in the person's time zone.
const TIMES = Array.from({ length: 48 }, (_, index) => {
  const value = `${String(Math.floor(index / 2)).padStart(2, "0")}:${index % 2 ? "30" : "00"}`;
  const label = new Date(`2000-01-01T${value}:00`).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  return { value, label };
});
const quiet = computed({
  get: () => Boolean(push.value?.settings.quietFrom && push.value?.settings.quietTo),
  set: (on) => save(on ? { quietFrom: "22:00", quietTo: "07:00", timeZone: currentTimeZone() } : { quietFrom: null, quietTo: null })
});
const quietTime = (key) => computed({
  get: () => push.value?.settings[key] || "",
  set: (value) => save({ [key]: value, timeZone: currentTimeZone() })
});
const quietFrom = quietTime("quietFrom");
const quietTo = quietTime("quietTo");

const added = (device) => new Date(device.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
</script>

<template>
  <p class="mb-set-group">Notifications</p>
  <div class="mb-set-card">
    <div v-if="loadFailed" class="mb-set-row">
      <span class="mb-set-row__text"><span class="mb-set-row__description">Notification settings didn't load.</span></span>
      <button type="button" class="mb-set-pill" @click="load">Try again</button>
    </div>
    <div v-else-if="!push" aria-busy="true" aria-label="Loading notification settings">
      <v-skeleton-loader v-for="row in 4" :key="row" type="list-item-two-line" class="mb-set-row" />
    </div>
    <template v-else>
      <div class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Notifications on this device</span>
          <span class="mb-set-row__description">{{ blocker || "Results, questions and messages while Mercbot is closed." }}</span>
        </span>
        <button v-if="app.needsInstallForPush.value && push.enabled" type="button" class="mb-set-pill" @click="app.openGuide()">Show me how</button>
        <MercbotSwitch v-else-if="!blocker" v-model="allowed" label="Notifications on this device" :disabled="busy" />
      </div>
      <div v-if="thisDevice" class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Test</span>
          <span class="mb-set-row__description">Shows a notification here now.</span>
        </span>
        <button type="button" class="mb-set-pill" @click="test">Send a test notification</button>
      </div>
      <template v-if="push.enabled">
        <div class="mb-set-row">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">Routine and watch results</span>
            <span class="mb-set-row__description">When a routine or a watch your bot runs for you has something.</span>
          </span>
          <MercbotSwitch v-model="results" label="Routine and watch results" />
        </div>
        <div class="mb-set-row">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">A bot is waiting for you</span>
            <span class="mb-set-row__description">A question, an approval, a draft to check or an account to connect.</span>
          </span>
          <MercbotSwitch v-model="waiting" label="A bot is waiting for you" />
        </div>
        <div class="mb-set-row">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">Messages and mentions</span>
            <span class="mb-set-row__description">Your chats with a bot, direct messages, and rooms when someone mentions you.</span>
          </span>
          <MercbotSwitch v-model="messages" label="Messages and mentions" />
        </div>
        <div class="mb-set-row">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">Show message text</span>
            <span class="mb-set-row__description">Off, a notification says only who it's from, not what it says.</span>
          </span>
          <MercbotSwitch v-model="showText" label="Show message text" />
        </div>
        <div class="mb-set-row mb-notify__quiet">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">Quiet hours</span>
            <span class="mb-set-row__description">No notifications between these times. Nothing is lost: it's all in Mercbot.</span>
          </span>
          <template v-if="quiet">
            <MercbotSettingsSelect v-model="quietFrom" label="Quiet from" :options="TIMES" :width="110" />
            <span class="mb-notify__to">to</span>
            <MercbotSettingsSelect v-model="quietTo" label="Quiet until" :options="TIMES" :width="110" />
          </template>
          <MercbotSwitch v-model="quiet" label="Quiet hours" />
        </div>
        <div v-for="device in push.devices" :key="device.id" class="mb-set-row">
          <span class="mb-set-row__text">
            <span class="mb-set-row__label">{{ device.label }}<span v-if="device.id === thisDevice?.id" class="mb-notify__this"> · This device</span></span>
            <span class="mb-set-row__description">Added {{ added(device) }}</span>
          </span>
          <button type="button" class="mb-set-pill" :aria-label="`Remove ${device.label}`" @click="forget(device)">Remove</button>
        </div>
      </template>
    </template>
  </div>
  <p v-if="problem" class="mb-set-caption mb-notify__problem" role="alert">{{ problem }}</p>
  <p v-if="push?.enabled" class="mb-set-caption">Muted chats never notify. A notification goes only if you haven't read the chat in Mercbot by then.</p>
</template>

<style scoped>
.mb-notify__quiet {
  flex-wrap: wrap;
}

.mb-notify__to {
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-notify__problem {
  color: rgb(var(--v-theme-error));
}

.mb-notify__this {
  color: rgb(var(--v-theme-primary));
}
</style>
