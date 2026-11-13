<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRouter } from "vue-router";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import MercbotSettingsSelect from "./MercbotSettingsSelect.vue";
import MercbotSwitch from "./MercbotSwitch.vue";
import { accountApi } from "./accountApi.js";
import { detectedTimeZone, shellPreferences } from "./shellPreferences.js";
import { pageMediaDevices, supportedTimeZones } from "@/browser.js";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import extensions from "./extensions.js";

// Settings → General: the account, appearance, the microphone, and the
// bots' time zone with asking-first rules. Everything applies as soon as it's changed.
const paths = usePaths();
const props = defineProps({
  theme: { type: String, default: "system" },
  displayName: { type: String, default: "" },
  initials: { type: String, default: "" }
});
const emit = defineEmits(["theme", "failure", "notify"]);
const router = useRouter();

const email = ref("");
onMounted(async () => {
  try {
    email.value = (await accountApi.settings())?.data?.attributes?.profile?.email || "";
  } catch {
    email.value = "";
  }
});

async function copyEmail() {
  try {
    await navigator.clipboard.writeText(email.value);
    emit("notify", "Email copied");
  } catch (error) {
    emit("failure", error);
  }
}

// The actions a copy built on Mercbot adds (extensions.js): the last one asked about, and whether it is being asked.
const confirming = ref(null);
const asking = ref(false);
function act(action) {
  if (!action.confirm) {
    action.run();
    return;
  }
  confirming.value = action;
  asking.value = true;
}

const themeValue = computed({ get: () => props.theme, set: (value) => emit("theme", value) });
const THEMES = [
  { value: "system", label: "Follow system" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" }
];
const ACCENTS = [
  { value: "bot", label: "Bot colour" },
  { value: "black", label: "Black" }
];

// About 30 languages: each in its own words, with the English name beside it.
const LANGUAGE_TAGS = ["ar", "zh-CN", "zh-TW", "cs", "da", "nl", "en", "fi", "fr", "de", "el", "he", "hi", "hu", "id", "it", "ja", "ko", "ms", "nb", "pl", "pt-BR", "pt-PT", "ro", "ru", "es", "sv", "th", "tr", "uk", "vi"];
const english = new Intl.DisplayNames(["en"], { type: "language" });
const LANGUAGES = [
  { value: "system", label: "Follow system" },
  ...LANGUAGE_TAGS
    .map((tag) => ({ value: tag, label: new Intl.DisplayNames([tag], { type: "language" }).of(tag), hint: english.of(tag) }))
    .sort((a, b) => a.hint.localeCompare(b.hint))
];

// Every time zone by its region/city name, with the time there now.
const now = ref(new Date());
const clock = setInterval(() => { now.value = new Date(); }, 30000);
onBeforeUnmount(() => clearInterval(clock));
const ZONES = supportedTimeZones();
const formatters = new Map();
function timeIn(zone) {
  if (!formatters.has(zone)) formatters.set(zone, new Intl.DateTimeFormat(undefined, { timeZone: zone, hour: "numeric", minute: "2-digit" }));
  return formatters.get(zone).format(now.value);
}
const timeZones = computed(() => [
  { value: "auto", label: `Auto-detect (${detectedTimeZone()})` },
  ...ZONES.map((zone) => ({ value: zone, label: zone, hint: timeIn(zone) }))
]);

const microphones = ref([{ value: "", label: "System default" }]);
onMounted(async () => {
  try {
    const devices = await pageMediaDevices();
    const inputs = devices.filter((device) => device.kind === "audioinput" && device.deviceId && device.deviceId !== "default");
    microphones.value = [
      { value: "", label: "System default" },
      ...inputs.map((device, index) => ({ value: device.deviceId, label: device.label || `Microphone ${index + 1}` }))
    ];
  } catch {
    // Without access to devices, the system default is the only choice.
  }
});
</script>

<template>
  <section>
    <p class="mb-set-group">Account</p>
    <div class="mb-set-card">
      <div class="mb-set-row">
        <span class="mb-general__avatar">{{ initials }}</span>
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">{{ displayName }}</span>
          <span class="mb-set-row__description mb-general__email">
            {{ email }}
            <button v-if="email" type="button" class="mb-general__copy" aria-label="Copy email" @click="copyEmail">
              <v-icon icon="$contentCopy" size="13" />
            </button>
          </span>
        </span>
        <button type="button" class="mb-set-pill" @click="router.push(paths.page('/', { surface: 'account' }))">Account details</button>
        <button v-for="action in extensions.generalActions" :key="action.title" type="button" class="mb-set-pill" @click="act(action)">{{ action.title }}</button>
      </div>
    </div>

    <p class="mb-set-group">Appearance</p>
    <div class="mb-set-card">
      <div class="mb-set-row">
        <span class="mb-set-row__text"><span class="mb-set-row__label">Theme</span></span>
        <MercbotSettingsSelect v-model="themeValue" label="Theme" :options="THEMES" :width="180" />
      </div>
      <div class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Accent</span>
          <span class="mb-set-row__description">The colour of your messages and the send button.</span>
        </span>
        <MercbotSettingsSelect v-model="shellPreferences.accent" label="Accent" :options="ACCENTS" :width="180" />
      </div>
      <div class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Language</span>
          <span class="mb-set-row__description">Your bots reply in this language.</span>
        </span>
        <MercbotSettingsSelect v-model="shellPreferences.language" label="Language" :options="LANGUAGES" searchable :width="280" />
      </div>
      <div class="mb-set-row">
        <span class="mb-set-row__text"><span class="mb-set-row__label">Spell check while typing</span></span>
        <MercbotSwitch v-model="shellPreferences.spellcheck" label="Spell check while typing" />
      </div>
    </div>

    <p class="mb-set-group">System</p>
    <div class="mb-set-card">
      <div class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Microphone</span>
          <span class="mb-set-row__description">Used for dictation and voice conversations.</span>
        </span>
        <MercbotSettingsSelect v-model="shellPreferences.microphoneId" label="Microphone" :options="microphones" :width="240" />
      </div>
    </div>

    <p class="mb-set-group">Bots</p>
    <div class="mb-set-card">
      <div class="mb-set-row">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">Timezone</span>
          <span class="mb-set-row__description">Used for routines and the times your bots mention.</span>
        </span>
        <MercbotSettingsSelect v-model="shellPreferences.timeZone" label="Timezone" :options="timeZones" searchable :width="320" />
      </div>
    </div>

    <MercbotConfirmDialog
      v-if="confirming"
      v-model="asking"
      :title="confirming.confirm.title"
      :confirm-label="confirming.confirm.label"
      dim
      @confirm="confirming.run()"
    />
  </section>
</template>

<style scoped>
.mb-general__avatar {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  background: rgb(var(--v-theme-surface-container-highest));
  font-size: 15px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-general__email {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.mb-general__copy {
  display: inline-flex;
  padding: 2px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: rgb(var(--v-theme-on-surface-variant));
  cursor: pointer;
}
</style>
