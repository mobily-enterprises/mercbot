import { icons } from "./icons.js";

// Mercbot's one font, the system UI stack, for body text and headings alike (docs/ui-style.md, section 2).
const SYSTEM_FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "DejaVu Sans", sans-serif';

// Mercbot's only theme facts. JSKIT's material-web generates the light and dark Material 3 schemes from the seed,
// Mercbot's link blue, whose scheme gives the #565F71 secondary Mercbot already showed. The open bot's colour still
// becomes the accent (useShellTheme), so `link` is the blue that stays whatever the accent is: links, switches that
// are on and a black bot's chosen options, with its four roles in both schemes. codeString and codeKeyword colour a
// code block's strings and keywords (richText.js) the same way, keeping their own hues. Bot, home and app colours and
// artwork are content, in palettes.js. icons.js holds the glyphs JSKIT's aliases lack. The system font is both of
// Material 3's typefaces, in place of JSKIT's Roboto Flex: each scheme declares them as --v-font-heading and
// --v-font-body wherever its class is (<v-app>, each dialog and menu, an app's own theme), so the page's text and
// Material 3's type classes read it in light and dark.
export const theme = {
  seed: "#0B6DD3",
  colors: {
    link: "#0B6DD3",
    codeString: { value: "#9E94D5", blend: false },
    codeKeyword: { value: "#B3003F", blend: false }
  },
  typography: { brand: SYSTEM_FONT, plain: SYSTEM_FONT },
  icons
};
