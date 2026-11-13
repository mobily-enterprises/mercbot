// Themes for apps (D-35, stage 3): fixed choices, never CSS. A home has a look; an app can change
// its colour and density. The colour must stand out from the page so buttons and links can be seen
// (3:1 against the light or dark background, WCAG non-text contrast); text on it is white or black,
// whichever reads better.
export const THEME_CHOICES = {
  mode: ["light", "dark", "system"],
  font: ["system", "classic", "serif", "rounded"],
  corners: ["square", "soft", "round"],
  density: ["comfortable", "compact"]
};
export const DEFAULT_THEME = { color: "#1C1C1C", mode: "light", font: "system", corners: "soft", density: "comfortable", logo: null };
const BACKGROUND = { light: "#FCFCFC", dark: "#121212" };
const HEX = /^#[0-9a-f]{6}$/iu;
const LOGO = /^data:image\/(png|jpeg|webp);base64,[a-z0-9+/=]+$/iu;
const LOGO_MAX_BYTES = 200 * 1024;

function luminance(hex) {
  const [r, g, b] = [1, 3, 5]
    .map((index) => parseInt(hex.slice(index, index + 2), 16) / 255)
    .map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a, b) {
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}
/** White or black text on a colour, whichever has more contrast. */
export const onColor = (hex) => (contrast(hex, "#FFFFFF") >= contrast(hex, "#000000") ? "#FFFFFF" : "#000000");

/** Problems with a theme (or an app's partial override), as sentences; none means it's fine. */
export function checkTheme(theme = {}, { partial = false } = {}) {
  const problems = [];
  for (const key of Object.keys(theme)) {
    if (!["color", "logo", ...Object.keys(THEME_CHOICES)].includes(key)) problems.push(`"${key}" isn't a theme setting.`);
  }
  for (const [key, choices] of Object.entries(THEME_CHOICES)) {
    if (theme[key] === undefined) {
      if (!partial) problems.push(`Choose a ${key}.`);
    } else if (!choices.includes(theme[key])) {
      problems.push(`${key} must be one of: ${choices.join(", ")}.`);
    }
  }
  if (theme.color !== undefined && theme.color !== null) {
    if (!HEX.test(String(theme.color))) {
      problems.push("The colour must look like #1E86FC.");
    } else {
      const modes = theme.mode === "system" || theme.mode === undefined ? ["light", "dark"] : [theme.mode];
      for (const mode of modes) {
        if (contrast(theme.color, BACKGROUND[mode]) < 3) {
          problems.push(`That colour is too hard to see on a ${mode} page; pick a ${mode === "light" ? "darker" : "lighter"} one.`);
        }
      }
    }
  } else if (!partial) {
    problems.push("Choose a colour.");
  }
  if (theme.logo !== undefined && theme.logo !== null) {
    if (!LOGO.test(String(theme.logo))) problems.push("The logo must be a PNG, JPEG or WebP picture.");
    else if (String(theme.logo).length * 0.75 > LOGO_MAX_BYTES) problems.push("The logo must be 200 KB or smaller.");
  }
  return problems;
}

/** The look an app uses: the home's theme with the app's own colour and density on top. */
export function effectiveTheme(home = null, app = null) {
  const merged = { ...DEFAULT_THEME, ...(home || {}) };
  if (app?.color) merged.color = app.color;
  if (app?.density) merged.density = app.density;
  return merged;
}

/** Pure helpers and data the tests reach directly (rule 64). */
export const __testables = Object.freeze({ contrast });
