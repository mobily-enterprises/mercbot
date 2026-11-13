import { describe, expect, it } from "vitest";
import { ALL_SHAPES, EYE_STYLES, SHAPES, SPECIAL_SHAPE, eyeParts, shapeById } from "../../src/components/mercbot/avatarShapes.js";
import { BOT_PALETTE } from "../../src/theme/palettes.js";
import { choiceColor } from "../../src/components/mercbot/accent.js";

describe("new bot choices (D-44)", () => {
  it("offers 28 clouds plus Mercbot's own, and the 11-colour palette", () => {
    expect(SHAPES).toHaveLength(28);
    expect(new Set(ALL_SHAPES.map((shape) => shape.id)).size).toBe(29);
    expect(SPECIAL_SHAPE.id).toBe("mercbot");
    expect(SPECIAL_SHAPE.color).toBe("#FD690F");
    expect(BOT_PALETTE).toHaveLength(11);
  });

  it("never falls back to, or offers, a ball", () => {
    expect(shapeById("nope").id).toBe("cloud");
    expect(shapeById("round").id).toBe("cloud");
    expect(shapeById("citrus").id).toBe("cloud");
    expect(shapeById(undefined).id).toBe("cloud");
    // A cloud is several puffs; no shape is a single circle.
    for (const shape of ALL_SHAPES) expect(shape.parts.length, shape.id).toBeGreaterThan(2);
  });

  it("gives every cloud its own kind of eyes, and a place for the Builder's hat", () => {
    expect(new Set(ALL_SHAPES.map((shape) => shape.eyes)).size).toBe(ALL_SHAPES.length);
    for (const shape of ALL_SHAPES) {
      expect(EYE_STYLES, shape.id).toContain(shape.eyes);
      expect(shape.hat, shape.id).toHaveLength(3);
    }
  });

  it("moves only the iris, inside the white of the eye", () => {
    for (const style of EYE_STYLES) {
      const eye = eyeParts(36, style);
      expect(eye.pupil.length, style).toBeGreaterThan(0);
      // Lids and lashes sit over the iris and stay put.
      expect(eye.pupil.some((part) => part.paint === "body" && part.tag === "path"), style).toBe(false);
    }
  });

  it("colours chosen options with the bot colour, using blue for black bots", () => {
    expect(choiceColor("#14C16F")).toBe("#14C16F");
    expect(choiceColor("#000000")).toBe("rgb(var(--v-theme-link))");
    expect(choiceColor("#1C1C1C")).toBe("rgb(var(--v-theme-link))");
  });
});
