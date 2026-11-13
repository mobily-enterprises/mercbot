import assert from "node:assert/strict";
import test from "node:test";
import { BOT_PALETTE, BRAND_COLOR } from "../../packages/bots/src/server/botPalette.js";
import { BOT_PALETTE as SHOWN_PALETTE, BRAND_ORANGE } from "../../src/theme/palettes.js";

// The bot palette: the server accepts exactly the colours the new bot dialog offers, in the same order,
// and Mercbot's own cloud keeps the brand orange (D-44).
test("the server's bot palette is the one the client shows", () => {
  assert.deepEqual([...BOT_PALETTE], SHOWN_PALETTE.map((entry) => entry.color));
  assert.equal(BRAND_COLOR, BRAND_ORANGE);
});
