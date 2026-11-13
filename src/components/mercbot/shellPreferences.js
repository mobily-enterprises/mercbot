import { reactive, watch } from "vue";

// Per-device shell choices that survive reloads: the sidebar, the details panel, the accent, the microphone, the
// language, the time zone and the voice.
const STORAGE_KEY = "mercbot.shell";
const DEFAULTS = Object.freeze({
  compact: false,
  sidebarWidth: 280,
  detailsOpen: false,
  detailsWidth: 320,
  accent: "bot",
  hiddenExpanded: false,
  detailsTab: "details",
  // Settings: kept on this device and sent with each request that needs them.
  spellcheck: true,
  microphoneId: "",
  language: "system",
  timeZone: "auto",
  // Voice conversation choices from the call bar's settings.
  voiceName: "",
  voiceRate: 1
});

function readStored() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

const stored = typeof window === "undefined" ? {} : readStored();

// readable-check: allow module-state - shared resource: the shell, its panels and Settings read and change one set of the person's preferences
export const shellPreferences = reactive({
  compact: typeof stored.compact === "boolean" ? stored.compact : DEFAULTS.compact,
  sidebarWidth: Number(stored.sidebarWidth) || DEFAULTS.sidebarWidth,
  detailsOpen: typeof stored.detailsOpen === "boolean" ? stored.detailsOpen : DEFAULTS.detailsOpen,
  detailsWidth: Number(stored.detailsWidth) || DEFAULTS.detailsWidth,
  accent: stored.accent === "black" ? "black" : DEFAULTS.accent,
  hiddenExpanded: stored.hiddenExpanded === true,
  detailsTab: ["details", "files", "library", "computer"].includes(stored.detailsTab) ? stored.detailsTab : DEFAULTS.detailsTab,
  spellcheck: stored.spellcheck !== false,
  microphoneId: typeof stored.microphoneId === "string" ? stored.microphoneId : DEFAULTS.microphoneId,
  language: typeof stored.language === "string" && stored.language ? stored.language : DEFAULTS.language,
  timeZone: typeof stored.timeZone === "string" && stored.timeZone ? stored.timeZone : DEFAULTS.timeZone,
  voiceName: typeof stored.voiceName === "string" ? stored.voiceName : DEFAULTS.voiceName,
  voiceRate: [0.8, 1, 1.25, 1.5].includes(stored.voiceRate) ? stored.voiceRate : DEFAULTS.voiceRate
});

// The language and time zone in use: the chosen ones, or the browser's.
export function currentLanguage() {
  return shellPreferences.language === "system" ? navigator.language || "en" : shellPreferences.language;
}

export function detectedTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

export function currentTimeZone() {
  return shellPreferences.timeZone === "auto" ? detectedTimeZone() : shellPreferences.timeZone;
}

if (typeof window !== "undefined") {
  watch(shellPreferences, (value) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch {
      // Storage can be unavailable (private mode); choices then last for this visit.
    }
  });
}
