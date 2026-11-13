import { BOT_COLOURS, ONBOARDING_BLACK, ON_IDENTITY } from "@/theme/palettes.js";

// Both the onboarding black and the palette's black count as black.
export function isBlack(color) {
  return !color || [ONBOARDING_BLACK, BOT_COLOURS.Black].includes(color.toUpperCase());
}

// Chosen options take the bot's colour; black bots use the link blue. onChoiceColor is the text on it.
export function choiceColor(color) {
  return isBlack(color) ? "rgb(var(--v-theme-link))" : color;
}
export function onChoiceColor(color) {
  return isBlack(color) ? "rgb(var(--v-theme-on-link))" : ON_IDENTITY;
}

// The accent is the bot's colour, or black: the scheme's inverse surface, which is near-black in light and
// near-white in dark. `colors` is the light or dark scheme's colours.
export function resolveAccent({ botColor, accentSetting, colors }) {
  if (accentSetting === "black" || isBlack(botColor)) {
    return { primary: colors["inverse-surface"], onPrimary: colors["inverse-on-surface"] };
  }
  return { primary: botColor, onPrimary: ON_IDENTITY };
}

// A bot's own avatar colour: black bots render near-white in dark.
export function resolveBotColor(botColor, colors) {
  return resolveAccent({ botColor, accentSetting: "bot", colors });
}

// A bot's colour mixed towards black or white, e.g. its name label in a group.
export function mixColor(color, toward, amount) {
  const hex = String(color || "").replace("#", "");
  if (!/^[0-9a-f]{6}$/iu.test(hex)) return color;
  const target = toward === "white" ? 255 : 0;
  const channel = (at) => Math.round(parseInt(hex.slice(at, at + 2), 16) * (1 - amount) + target * amount);
  return `rgb(${channel(0)}, ${channel(2)}, ${channel(4)})`;
}
