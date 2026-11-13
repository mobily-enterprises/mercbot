import { icons } from "./icons.js";

// Mercbot's only theme facts. JSKIT's material-web generates the light and dark Material 3 schemes from the seed,
// Mercbot's link blue, whose scheme gives the #565F71 secondary Mercbot already showed. The open bot's colour still
// becomes the accent (useShellTheme), so `link` is the blue that stays whatever the accent is: links, switches that
// are on and a black bot's chosen options, with its four roles in both schemes. codeString and codeKeyword colour a
// code block's strings and keywords (richText.js) the same way, keeping their own hues. Bot, home and app colours and
// artwork are content, in palettes.js. icons.js holds the glyphs JSKIT's aliases lack.
export const theme = {
  seed: "#0B6DD3",
  colors: {
    link: "#0B6DD3",
    codeString: { value: "#9E94D5", blend: false },
    codeKeyword: { value: "#B3003F", blend: false }
  },
  icons
};
