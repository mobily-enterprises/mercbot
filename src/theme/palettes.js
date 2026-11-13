// Mercbot's content colours: who a bot, a home or an app is, and the artwork drawn for them.
// They are plain colours, used as they are in light and dark. Everything else on screen takes the Material roles of
// the theme (index.js), so nothing here is UI chrome.

// The bot palette, in the order the new bot dialog shows it. The server checks a bot's colour against the
// same list (packages/bots/src/server/botList.js; tests/server/botPalette.test.js keeps the two equal).
export const BOT_COLOURS = Object.freeze({
  Black: "#000000",
  Brown: "#A06B39",
  Red: "#FB2B3E",
  Orange: "#FD690F",
  Amber: "#F59312",
  Green: "#14C16F",
  Teal: "#13B7A2",
  Blue: "#1E86FC",
  Purple: "#8F59F9",
  Pink: "#F93498",
  Grey: "#959595"
});
export const BOT_PALETTE = Object.freeze(Object.entries(BOT_COLOURS).map(([name, color]) => ({ name, color })));

// The onboarding black: the first bot's colour, which counts as the palette's Black.
export const ONBOARDING_BLACK = "#1C1C1C";

// Mercbot's own orange (D-44): the logo's, and its special cloud's.
export const BRAND_ORANGE = "#FD690F";

// Bots drawn without a colour of their own: a computer's grey and the new bot before it has one.
export const COMPUTER_GREY = "#9A9A9A";
export const NEW_BOT_GREY = "#C4C4C4";

// White drawn on an identity colour: a bot's eye whites and initial, an app's glyph, a home tile's initial.
export const ON_IDENTITY = "#FFFFFF";

// The paper behind pictures made for white: a bot's chart picture, an app's QR code, an app's logo picture.
export const PAPER = "#FFFFFF";

// Avatar art (D-44): the eyes' ink, the cheeks and tears, the weather clouds' own colours and the Builder's beanie.
export const AVATAR_INK = "#241B33";
export const AVATAR_BLUSH = "#FF6B8E";
export const AVATAR_TEAR = "#8FD3FF";
export const RAINBOW = Object.freeze(["#FF5A5F", "#FFB23D", "#7BD35B", "#3DA5FF"]);
export const SUN = "#FFC83D";
export const MOON = "#FFD54A";
export const BEANIE = Object.freeze({ yellow: SUN, blue: "#2D7FF9", red: "#F0435A" });

// A home's tile in the home switcher (D-36): its initial on one of these, picked from its name.
export const HOME_TILES = Object.freeze(["#1C1C1C", "#A06B39", "#FB2B3E", "#FD690F", "#14C16F", "#2F80ED", "#8E44AD", "#E84393"]);

// Chart series (D-35): a fixed categorical order, checked for colour-blind readers, stepped for the light and dark
// surfaces.
export const CHART_SERIES = Object.freeze({
  light: Object.freeze(["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"]),
  dark: Object.freeze(["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"])
});

// The colours a person can give their apps (Apps → Look); the first is the apps' default.
export const APP_SWATCHES = Object.freeze(["#1C1C1C", "#1E5BD8", "#0B7A5B", "#7E3FB2", "#B3261E", "#A15C00"]);

// The first-run intro's picture: bots at work in windows under a blue sky.
export const INTRO_SCENE = Object.freeze({ skyFrom: "#E9F3FD", skyTo: "#81BEFD", dots: "#FFFFFF", window: "#FFFFFF", windowBar: "#EEF3F8", windowLine: "#E3EAF2" });

// The phone drawn in the front page's roles.
export const PHONE = "#1C1C1C";
