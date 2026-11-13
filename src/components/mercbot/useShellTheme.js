import { ref, watch } from "vue";
import { useTheme } from "vuetify";
import { resolveAccent } from "./accent.js";
import { botsApi } from "./botsApi.js";
import { shellPreferences } from "./shellPreferences.js";

const THEME_KEY = "jskit.themePreference";

function readThemePreference() {
  try {
    return window.localStorage.getItem(THEME_KEY) || "system";
  } catch {
    return "system";
  }
}

/**
 * The shell's colours: the accent follows the open bot (or the Accent setting), and the light or
 * dark theme follows the person's choice. `accentColor` is the open bot's colour and
 * `reportFailure` explains a theme that didn't save to the account.
 * @param {{ accentColor: import("vue").ComputedRef<string>, reportFailure: import("../../types.js").ReportFailure }} options
 */
export function useShellTheme({ accentColor, reportFailure }) {
  const theme = useTheme();
  const themePreference = ref(readThemePreference());

  watch(
    [() => accentColor.value, () => shellPreferences.accent],
    () => {
      for (const name of ["light", "dark"]) {
        const colors = theme.themes.value[name].colors;
        const accent = resolveAccent({ botColor: accentColor.value, accentSetting: shellPreferences.accent, colors });
        colors.primary = accent.primary;
        colors["on-primary"] = accent.onPrimary;
      }
    },
    { immediate: true }
  );

  // The same setting as Settings → Preferences: applied at once, kept on the device and the account.
  function setTheme(preference) {
    themePreference.value = preference;
    try {
      window.localStorage.setItem(THEME_KEY, preference);
    } catch {
      // Storage unavailable: the account still keeps it.
    }
    const dark = preference === "dark" || (preference === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    theme.change(dark ? "dark" : "light");
    botsApi.setThemePreference(preference).catch((error) => reportFailure("The theme didn't save to your account.", error));
  }

  return { themePreference, setTheme };
}
