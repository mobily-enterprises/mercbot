// Our own bot bodies (D-44): every bot is a cloud, never a ball. Each shape is a union of puffs
// (circles), rounded bases and the odd extra (raindrops, a bolt, a speech-bubble tail) in a 100×100
// box, all in the bot's colour. eyeY moves the eyes to the cloud's visual centre; `eyes` names the
// cloud's own kind of manga eyes (EYES below), so no two clouds share a face; `hat` is where the
// Builder's hat sits on it: [x, y, tilt in degrees].

import { AVATAR_INK, BEANIE, BRAND_ORANGE, MOON, RAINBOW, SUN } from "@/theme/palettes.js";

const puff = (cx, cy, r) => ({ tag: "circle", attrs: { cx, cy, r } });
const base = (x, y, width, height) => ({ tag: "rect", attrs: { x, y, width, height, rx: Math.min(width, height) / 2 } });
const shape = (d) => ({ tag: "path", attrs: { d } });
const raindrop = (x, y) => shape(`M${x} ${y - 9} C${x + 2} ${y - 4} ${x + 5.5} ${y - 1} ${x + 5.5} ${y + 2.5} A5.5 5.5 0 0 1 ${x - 5.5} ${y + 2.5} C${x - 5.5} ${y - 1} ${x - 2} ${y - 4} ${x} ${y - 9} Z`);
// Weather (all still: only the eyes ever move). `line` parts are strokes; `color` keeps a part in
// its own colour (a rainbow, the sun, the moon) or "ink" (a mouth) instead of the cloud's.
const line = (d, width, color) => ({ tag: "path", attrs: { d, "stroke-width": width }, line: true, color });
const tinted = (part, color) => ({ ...part, color });
const bolt = (x, y) => shape(`M${x} ${y} L${x - 10} ${y + 15} L${x - 2} ${y + 15} L${x - 7} ${y + 29} L${x + 10} ${y + 10} L${x + 2} ${y + 10} L${x + 7} ${y} Z`);
const flake = (x, y, r) => line(`M${x - r} ${y} L${x + r} ${y} M${x - r / 2} ${y - r * 0.87} L${x + r / 2} ${y + r * 0.87} M${x - r / 2} ${y + r * 0.87} L${x + r / 2} ${y - r * 0.87}`, 3.4);
const hailstone = (x, y, r) => shape(`M${x} ${y - r} L${x + r} ${y} L${x} ${y + r} L${x - r} ${y} Z`);
const sparkle4 = (x, y, r) => shape(`M${x} ${y - r} Q${x} ${y} ${x + r} ${y} Q${x} ${y} ${x} ${y + r} Q${x} ${y} ${x - r} ${y} Q${x} ${y} ${x} ${y - r} Z`);

export const SHAPES = [
  // The domed cumulus and the four-puff cloud come first: the two shapes the others grew from.
  { id: "cloud", label: "Cumulus", eyes: "shoujo", parts: [puff(26, 59, 19), puff(74, 59, 19), puff(50, 42, 26), base(7, 60, 86, 26)], eyeY: 56, hat: [50, 19, 0] },
  { id: "clover", label: "Four-puff cloud", eyes: "button", parts: [puff(31, 31, 25), puff(69, 31, 25), puff(31, 69, 25), puff(69, 69, 25), puff(50, 50, 26)], eyeY: 50, hat: [31, 9, -14] },
  { id: "stratus", label: "Long flat cloud", eyes: "sleepy", parts: [puff(14, 54, 10), puff(32, 46, 13), puff(53, 43, 15), puff(73, 46, 12), puff(89, 54, 9), base(0, 52, 100, 22)], eyeY: 59, hat: [53, 31, 0] },
  { id: "tower", label: "Towering cloud", eyes: "determined", parts: [puff(25, 72, 17), puff(22, 50, 15), puff(31, 29, 16), puff(75, 72, 17), puff(78, 49, 15), puff(68, 27, 17), puff(50, 21, 15), puff(50, 50, 28), base(8, 72, 84, 24)], eyeY: 57, hat: [64, 13, 10] },
  {
    id: "wisp",
    label: "Drifting wisp",
    eyes: "smug",
    parts: [puff(33, 50, 24), puff(57, 55, 17), puff(75, 62, 11), puff(87, 67, 7), puff(95, 70, 4), base(7, 58, 68, 22)],
    eyeY: 56, hat: [33, 29, -6]
  },
  {
    id: "storm",
    label: "Storm cloud",
    eyes: "surprised",
    parts: [puff(26, 46, 19), puff(51, 35, 24), puff(76, 45, 18), base(5, 44, 90, 30), shape("M51 70 L39 88 L50 88 L43 100 L65 79 L54 79 L61 70 Z")],
    eyeY: 51, hat: [51, 14, 0]
  },
  {
    id: "heart",
    label: "Heart cloud",
    eyes: "lovestruck",
    parts: [puff(31, 37, 22), puff(69, 37, 22), puff(50, 52, 24), puff(35, 61, 17), puff(65, 61, 17), puff(50, 75, 14), puff(50, 86, 7)],
    eyeY: 49, hat: [69, 18, 14]
  },
  { id: "rain", label: "Rain cloud", eyes: "teary", parts: [puff(29, 42, 18), puff(53, 33, 23), puff(75, 43, 16), base(7, 40, 86, 32), raindrop(32, 86), raindrop(52, 92), raindrop(72, 86)], eyeY: 50, hat: [53, 13, 0] },
  {
    id: "tuft",
    label: "Tufted cloud",
    eyes: "sparkly",
    parts: [puff(26, 62, 18), puff(74, 62, 18), puff(50, 47, 25), base(7, 62, 86, 26), puff(38, 25, 8), puff(29, 21, 6.5), puff(22, 19, 4.5)],
    eyeY: 60, hat: [62, 26, 22]
  },
  { id: "cluster", label: "Puff cluster", eyes: "dots", parts: [puff(38, 44, 15), puff(61, 42, 15), puff(25, 61, 13), puff(46, 64, 15), puff(68, 62, 14), puff(81, 49, 9), base(20, 48, 62, 22)], eyeY: 55, hat: [61, 30, 6] },
  { id: "lopsided", label: "One-sided cloud", eyes: "almond", parts: [puff(35, 44, 27), puff(63, 52, 17), puff(81, 64, 13), puff(15, 66, 12), base(3, 60, 92, 26)], eyeY: 56, hat: [35, 20, -4] },
  { id: "trefoil", label: "Three-puff cloud", eyes: "ringed", parts: [puff(50, 33, 26), puff(29, 64, 25), puff(71, 64, 25), puff(50, 56, 24)], eyeY: 54, hat: [50, 10, 0] },
  { id: "thought", label: "Thought cloud", eyes: "dreamy", parts: [puff(12, 54, 11), puff(24, 39, 13), puff(42, 31, 14), puff(61, 31, 14), puff(78, 39, 13), puff(89, 54, 11), puff(77, 68, 12), puff(59, 72, 13), puff(40, 72, 13), puff(23, 68, 12), base(12, 34, 77, 40)], eyeY: 53, hat: [51, 21, 0] },
  { id: "billow", label: "Billowing cloud", eyes: "starry", parts: [puff(24, 60, 18), puff(42, 40, 20), puff(67, 34, 18), puff(82, 55, 16), puff(60, 69, 20), puff(36, 74, 14), puff(55, 52, 24)], eyeY: 54, hat: [67, 19, 10] },
  // Weather clouds.
  {
    id: "thunderstorm",
    label: "Thunderstorm",
    eyes: "fierce",
    parts: [puff(27, 40, 17), puff(50, 30, 22), puff(74, 40, 17), base(6, 38, 88, 30), bolt(60, 64), raindrop(24, 84), raindrop(38, 93)],
    eyeY: 47, hat: [50, 11, 0]
  },
  {
    id: "doublebolt",
    label: "Double lightning",
    eyes: "zap",
    parts: [puff(22, 44, 16), puff(42, 32, 20), puff(64, 30, 20), puff(82, 44, 15), base(4, 40, 92, 28), bolt(34, 64), bolt(70, 64)],
    eyeY: 48, hat: [64, 13, 8]
  },
  {
    id: "downpour",
    label: "Downpour",
    eyes: "worried",
    parts: [
      puff(26, 38, 18), puff(50, 28, 22), puff(74, 38, 18), base(5, 34, 90, 34),
      line("M19 75 L14 92 M33 77 L27 98 M47 75 L42 92 M61 77 L55 98 M75 75 L70 92 M88 77 L84 90", 5)
    ],
    eyeY: 46, hat: [50, 9, 0]
  },
  {
    id: "drizzle",
    label: "Drizzle",
    eyes: "bean",
    parts: [puff(30, 44, 18), puff(54, 36, 21), puff(74, 46, 15), base(10, 44, 80, 26), line("M26 79 L24 85 M40 86 L38 92 M54 79 L52 85 M68 86 L66 92 M81 79 L79 85", 4)],
    eyeY: 51, hat: [54, 18, 0]
  },
  {
    id: "windy",
    label: "Windy cloud",
    eyes: "streak",
    parts: [
      puff(26, 48, 17), puff(46, 38, 20), puff(64, 46, 15), base(8, 48, 68, 26),
      line("M74 58 C84 58 92 56 95 50 C97 45 92 41 88 45", 5.5), line("M72 68 L93 68", 5.5),
      puff(84, 20, 6), puff(91, 17, 7), base(80, 18, 19, 8)
    ],
    eyeY: 56, hat: [46, 21, -4]
  },
  {
    id: "blower",
    label: "Blowing cloud",
    eyes: "cheeky",
    parts: [
      puff(42, 44, 22), puff(64, 38, 20), puff(80, 52, 16), base(22, 48, 72, 28),
      tinted(line("M27 63 m-3.2 0 a3.2 3.6 0 1 0 6.4 0 a3.2 3.6 0 1 0 -6.4 0", 2.8), "ink"),
      line("M18 57 L5 57 M18 65 L2 65 M18 73 C12 73 8 77 6 82", 5)
    ],
    eyeY: 50, hat: [64, 21, 6]
  },
  { id: "snow", label: "Snow cloud", eyes: "snowflake", parts: [puff(28, 42, 18), puff(52, 32, 22), puff(74, 42, 16), base(7, 40, 86, 30), flake(26, 84, 7), flake(50, 91, 7), flake(74, 84, 7)], eyeY: 48, hat: [52, 13, 0] },
  {
    id: "hail",
    label: "Hail cloud",
    eyes: "block",
    parts: [puff(25, 40, 16), puff(46, 30, 20), puff(68, 32, 19), puff(84, 44, 13), base(5, 38, 90, 30), hailstone(24, 80, 6), hailstone(42, 91, 6), hailstone(60, 80, 6), hailstone(78, 91, 6)],
    eyeY: 47, hat: [46, 13, -6]
  },
  { id: "sleet", label: "Sleet cloud", eyes: "mixed", parts: [puff(30, 40, 19), puff(54, 32, 21), puff(76, 44, 15), base(8, 40, 84, 30), raindrop(28, 87), flake(50, 88, 7), raindrop(72, 87)], eyeY: 48, hat: [54, 14, 0] },
  {
    id: "fog",
    label: "Fog cloud",
    eyes: "misty",
    parts: [puff(30, 36, 17), puff(52, 28, 20), puff(72, 38, 15), base(10, 34, 80, 26), base(2, 65, 70, 8), base(24, 77, 74, 8), base(10, 89, 58, 8)],
    eyeY: 44, hat: [52, 11, 0]
  },
  {
    id: "rainbow",
    label: "Rainbow cloud",
    eyes: "prism",
    parts: [
      ...RAINBOW.map((color, index) => tinted(line(`M${8 + index * 5} 66 A${42 - index * 5} ${42 - index * 5} 0 0 1 ${92 - index * 5} 66`, 5.2), color)),
      puff(26, 66, 16), puff(48, 57, 20), puff(70, 60, 17), puff(85, 70, 11), base(6, 64, 90, 28)
    ],
    eyeY: 67, hat: [48, 40, 0]
  },
  {
    id: "sunny",
    label: "Sunny spell",
    eyes: "sunny",
    parts: [
      tinted(line("M73 11 L73 4 M86.4 16.6 L91.4 11.6 M92 30 L99 30 M59.6 16.6 L54.6 11.6 M86.4 43.4 L91.4 48.4", 4.4), SUN),
      tinted(puff(73, 30, 15), SUN),
      puff(28, 58, 18), puff(50, 48, 21), puff(70, 60, 15), base(6, 58, 82, 28)
    ],
    eyeY: 62, hat: [40, 32, -12]
  },
  {
    id: "night",
    label: "Night cloud",
    eyes: "moon",
    parts: [
      tinted(shape("M76.4 9 A15 15 0 1 0 90.3 28.5 A12 12 0 0 1 76.4 9 Z"), MOON),
      tinted(sparkle4(20, 20, 8), MOON),
      puff(26, 58, 17), puff(48, 48, 21), puff(70, 58, 16), base(6, 56, 84, 28)
    ],
    eyeY: 60, hat: [44, 30, -6]
  },
  {
    id: "tornado",
    label: "Funnel cloud",
    eyes: "spiral",
    parts: [puff(28, 32, 15), puff(50, 24, 19), puff(72, 32, 15), base(8, 30, 84, 24), base(18, 54, 64, 11), base(30, 67, 46, 10), base(40, 79, 30, 9), base(46, 90, 16, 8)],
    eyeY: 38, hat: [50, 8, 0]
  }
];

// Mercbot's own cloud, which is also the logo (favicon.svg), always wears the brand orange (D-44):
// a cumulus with a little speech-bubble tail.
export const SPECIAL_SHAPE = {
  id: "mercbot",
  label: "Mercbot cloud",
  color: BRAND_ORANGE,
  eyes: "plain",
  parts: [puff(27, 58, 20), puff(52, 43, 27), puff(77, 54, 18), base(6, 56, 88, 30), shape("M17 76 C18 88 14 94 7 98 C21 98 31 93 37 82 Z")],
  eyeY: 58, hat: [52, 19, 0]
};

export const ALL_SHAPES = [...SHAPES, SPECIAL_SHAPE];

export function shapeById(id) {
  return ALL_SHAPES.find((entry) => entry.id === id) || SHAPES[0];
}

// One manga eye centred on (x, 46), as SVG elements in drawing order. Every cloud has its own kind
// of eye (`eyes` on the shape). `paint` names the colour MercbotAvatar gives each element: white,
// ink (iris), bead (solid eyes and lash lines: ink, or white on a black cloud), body (the cloud's
// colour, for glints and eyelids), blush, tear, or fixed (its own `color`). `shine` marks sparkles
// that twinkle on attention.
// None of them ever close: a lid, where an eye has one, is held for good.
const n = (value) => Math.round(value * 100) / 100;
const el = (tag, attrs, paint, extra = {}) => ({ tag, attrs, paint, ...extra });
const oval = (cx, cy, rx, ry, paint, extra) => el("ellipse", { cx: n(cx), cy: n(cy), rx, ry }, paint, extra);
const shine = (cx, cy, r) => el("circle", { cx: n(cx), cy: n(cy), r }, "white", { shine: true });
const stroke = (d, width, paint = "bead") => el("path", { d, fill: "none", "stroke-width": width, "stroke-linecap": "round", "stroke-linejoin": "round" }, paint);
const sparkle = (x, y, r) => el("path", { d: `M${n(x)} ${n(y - r)} Q${n(x)} ${n(y)} ${n(x + r)} ${n(y)} Q${n(x)} ${n(y)} ${n(x)} ${n(y + r)} Q${n(x)} ${n(y)} ${n(x - r)} ${n(y)} Q${n(x)} ${n(y)} ${n(x)} ${n(y - r)} Z` }, "white", { shine: true });
const heartGlint = (x, y, r) => el("path", { d: `M${n(x)} ${n(y + r)} C${n(x - r * 1.5)} ${n(y)} ${n(x - r * 0.8)} ${n(y - r * 1.2)} ${n(x)} ${n(y - r * 0.4)} C${n(x + r * 0.8)} ${n(y - r * 1.2)} ${n(x + r * 1.5)} ${n(y)} ${n(x)} ${n(y + r)} Z` }, "white", { shine: true });
// The upper lash over an eye of radii rx, ry, sweeping out towards the outer corner.
const lash = (x, out, cy, rx, ry, width = 3.4) => {
  const top = cy - ry;
  return stroke(`M${n(x - (rx + 0.8) * out)} ${n(cy + 1)} C${n(x - (rx + 0.2) * out)} ${n(top + 1.4)} ${n(x + 9 * out)} ${n(top - 4.6)} ${n(x + (rx + 1.6) * out)} ${n(cy - 5)}`, width);
};
// A held eyelid in the cloud's colour: the part of the eye above a line from its left to its right
// edge, with the line drawn as a lash.
const lid = (x, cy, rx, ry, leftY, rightY, bend) => {
  const a = rx + 0.6;
  const b = ry + 0.6;
  const edge = (y) => a * Math.sqrt(Math.max(0, 1 - ((y - cy) / b) ** 2));
  const [lx, rx2] = [x - edge(leftY), x + edge(rightY)];
  const mid = (leftY + rightY) / 2 + bend;
  const shapeD = `M${n(lx)} ${leftY} A${a} ${b} 0 0 1 ${n(rx2)} ${rightY} Q${x} ${n(mid)} ${n(lx)} ${leftY} Z`;
  return [el("path", { d: shapeD }, "body"), stroke(`M${n(lx + 0.8)} ${leftY} Q${x} ${n(mid)} ${n(rx2 - 0.8)} ${rightY}`, 3.6)];
};
// The glossy eye most styles start from: white, a tall iris, the cloud's colour glinting low in it.
const glossy = (x, { cy = 46, rx = 10.8, ry = 14.4, irx = 8.5, iry = 12.2, dx = 0, dy = 2 } = {}) => [
  oval(x, cy, rx, ry, "white"),
  oval(x + dx, cy + dy, irx, iry, "ink"),
  oval(x + dx + 0.6, cy + dy + iry * 0.6, n(irx * 0.6), 3.1, "body", { opacity: 0.9 })
];

// A spiral winding out from (x, y), as a polyline.
const spiralPath = (x, y) => {
  const points = Array.from({ length: 34 }, (_, index) => {
    const turn = index * 0.34;
    const r = 0.6 + turn * 0.72;
    return `${n(x + r * Math.cos(turn))} ${n(y + r * Math.sin(turn) * 1.15)}`;
  });
  return `M${points.join(" L")}`;
};

const EYES = {
  // Mercbot's own (and the logo's): glossy, one big and one small sparkle, a lash.
  plain: (x, out) => [...glossy(x), shine(x - 3, 41.8, 3.7), shine(x + 3.5, 51, 1.7), lash(x, out, 46, 10.8, 14.4)],
  // Big round shoujo eyes: a wide iris, three highlights and a heavy lash.
  shoujo: (x, out) => [
    ...glossy(x, { rx: 12, ry: 14.8, irx: 9.8, iry: 12.4, dy: 1.6 }),
    el("ellipse", { cx: x - 3.6, cy: 41.6, rx: 3.6, ry: 4.6 }, "white", { shine: true }),
    shine(x + 4, 50.6, 2),
    shine(x + 3.4, 40.2, 1.2),
    lash(x, out, 46, 12, 14.8, 3.8)
  ],
  // Solid button eyes with a single gleam.
  button: (x) => [oval(x, 47, 7.6, 10, "bead"), shine(x - 2.4, 43, 3), shine(x + 2.2, 51, 1.3)],
  // Sleepy: heavy lids held half down.
  sleepy: (x) => [...glossy(x), shine(x - 3, 47, 3.1), shine(x + 3.5, 52.4, 1.6), ...lid(x, 46, 10.8, 14.4, 42, 42, 3.5)],
  // Determined: lids slanting down towards the middle.
  determined: (x, out) => [...glossy(x), shine(x - 3, 46, 3.1), shine(x + 3.5, 52.4, 1.6), ...lid(x, 46, 10.8, 14.4, out < 0 ? 34 : 41, out < 0 ? 41 : 34, 1)],
  // Smug: flat half lids, the iris glancing to one side.
  smug: (x) => [
    ...glossy(x, { dx: 2.6 }),
    shine(x - 0.2, 45.6, 2.8),
    shine(x + 4.8, 53, 1.3),
    ...lid(x, 46, 10.8, 14.4, 40, 40, 0)
  ],
  // Surprised: wide white eyes with small pupils.
  surprised: (x, out) => [oval(x, 46, 11.6, 13.6, "white"), oval(x, 47, 4.4, 5.4, "ink"), shine(x - 1.4, 45, 1.7), lash(x, out, 46, 11.6, 13.6, 2.8)],
  // Lovestruck: heart-shaped glints.
  lovestruck: (x, out) => [...glossy(x), heartGlint(x - 2.6, 42.4, 4.2), shine(x + 3.6, 51.4, 1.6), lash(x, out, 46, 10.8, 14.4)],
  // Teary: brimming eyes, a wobbly shine along the bottom of the iris, a tear held at one corner.
  teary: (x, out) => [
    ...glossy(x, { irx: 9, iry: 12.6 }),
    shine(x - 3, 41.6, 3.6),
    shine(x + 3.8, 45.8, 1.5),
    { ...stroke(`M${x - 6.6} 53.6 Q${x - 3.3} 51 ${x} 53.6 Q${x + 3.3} 56.2 ${x + 6.6} 53.6`, 1.9, "white"), moves: true },
    ...(out < 0 ? [el("path", { d: `M${x - 10} 58 C${x - 9} 61 ${x - 7} 63 ${x - 7} 65 A3 3 0 0 1 ${x - 13} 65 C${x - 13} 63 ${x - 11} 61 ${x - 10} 58 Z` }, "tear")] : []),
    lash(x, out, 46, 10.8, 14.4)
  ],
  // Sparkly: star sparkles in the eyes.
  sparkly: (x, out) => [...glossy(x), sparkle(x - 3, 41.4, 5.6), sparkle(x + 3.6, 51.6, 2.8), shine(x + 3.4, 40.6, 1.1), lash(x, out, 46, 10.8, 14.4)],
  // Tiny dot eyes over rosy cheeks.
  dots: (x, out) => [oval(x - out, 48, 5.8, 7.2, "bead"), shine(x - out - 1.8, 45.6, 2), oval(x + 3 * out, 57.5, 6, 3.2, "blush")],
  // Almond eyes, gently lowered at the outer corners.
  almond: (x, out) => [
    el("path", { d: `M${x - 12 * out} 44 Q${x} 27 ${x + 13 * out} 48 Q${x} 63 ${x - 12 * out} 44 Z` }, "white"),
    oval(x + 0.5 * out, 46.4, 6.8, 8, "ink"),
    shine(x - 1.8, 43.4, 2.6),
    stroke(`M${x - 12.6 * out} 43.6 Q${x} 27 ${x + 13 * out} 48`, 3.8)
  ],
  // A ringed iris: the cloud's colour in a ring around a dark pupil.
  ringed: (x, out) => [
    oval(x, 46, 10.8, 14.4, "white"),
    oval(x, 48, 8.5, 12.2, "ink"),
    oval(x, 48.6, 6.2, 9, "body"),
    oval(x, 49, 3.6, 5.6, "ink"),
    shine(x - 3, 42, 3.2),
    shine(x + 3, 53, 1.4),
    lash(x, out, 46, 10.8, 14.4)
  ],
  // Dreamy: gazing upwards, lost in thought.
  dreamy: (x, out) => [
    oval(x, 46, 10.8, 14.4, "white"),
    oval(x + 0.4 * out, 40.6, 7.8, 9.4, "ink"),
    oval(x + 0.4 * out, 45.2, 4.4, 2.6, "body", { opacity: 0.9 }),
    shine(x - 2.4, 37.6, 2.8),
    shine(x + 3, 43.4, 1.3),
    lash(x, out, 46, 10.8, 14.4)
  ],
  // Star pupils: one bright star in the middle of each eye.
  starry: (x, out) => [...glossy(x), sparkle(x, 48, 6.6), shine(x - 4, 41, 1.6), lash(x, out, 46, 10.8, 14.4)],
  // Fierce: sharp eyes, flat along the top and slanting down to the middle.
  fierce: (x, out) => [
    el("path", { d: `M${x + 11.5 * out} 36 L${x - 11 * out} 43 Q${x - 11 * out} 59 ${x} 59 Q${x + 11.5 * out} 59 ${x + 11.5 * out} 36 Z` }, "white"),
    oval(x - 1 * out, 50, 6.6, 8.6, "ink"),
    oval(x - 0.6 * out, 55, 3.8, 2.4, "body", { opacity: 0.9 }),
    shine(x - 2.6, 46.6, 2.6),
    stroke(`M${x + 12.6 * out} 35 L${x - 12 * out} 43`, 4.6)
  ],
  // Lightning in the eyes: a bolt-shaped glint.
  zap: (x, out) => [
    ...glossy(x),
    el("path", { d: `M${x - 2} 35.5 L${x - 6} 43.5 L${x - 3} 43.5 L${x - 5} 50 L${x + 1} 41.5 L${x - 2} 41.5 L${x} 35.5 Z` }, "white", { shine: true }),
    shine(x + 3.6, 51.4, 1.6),
    lash(x, out, 46, 10.8, 14.4)
  ],
  // Worried: brows lifted in the middle over round, glistening eyes.
  worried: (x, out) => [
    ...glossy(x, { irx: 7.8, iry: 10.4, dy: 3 }),
    shine(x - 2.6, 44, 3.2),
    shine(x + 3, 52, 1.5),
    stroke(`M${x + 10 * out} 30 Q${x + 2 * out} 28 ${x - 9 * out} 22`, 3.8)
  ],
  // Bean eyes: tall, narrow and solid.
  bean: (x) => [oval(x, 47, 4.8, 10.4, "bead"), shine(x - 1.3, 42, 1.9)],
  // Light streaks: two bright slanting lines across the iris.
  streak: (x, out) => [
    ...glossy(x),
    { ...stroke(`M${x - 6} 45 L${x - 1.5} 38`, 2.6, "white"), shine: true },
    { ...stroke(`M${x - 4.6} 51 L${x + 1.6} 42`, 1.8, "white"), shine: true },
    lash(x, out, 46, 10.8, 14.4)
  ],
  // Cheeky: round eyes over puffed-up rosy cheeks.
  cheeky: (x, out) => [
    oval(x, 46, 10.4, 11.6, "white"),
    oval(x, 47.4, 7.4, 8.8, "ink"),
    oval(x + 0.4, 52, 4.2, 2.6, "body", { opacity: 0.9 }),
    shine(x - 2.6, 43.4, 3),
    shine(x + 3, 50.2, 1.4),
    lash(x, out, 46, 10.4, 11.6, 3.2),
    oval(x + 3 * out, 61, 8, 4.8, "blush")
  ],
  // Snowflake glints.
  snowflake: (x, out) => [
    ...glossy(x),
    { ...stroke(`M${x - 7.6} 42 L${x + 1.6} 42 M${x - 5.3} 38 L${x - 0.7} 46 M${x - 5.3} 46 L${x - 0.7} 38`, 1.7, "white"), shine: true },
    shine(x + 3.6, 51.4, 1.6),
    lash(x, out, 46, 10.8, 14.4)
  ],
  // Block eyes: rounded squares.
  block: (x) => [
    el("rect", { x: x - 9.6, y: 33, width: 19.2, height: 26, rx: 6 }, "white"),
    el("rect", { x: x - 6.8, y: 36.6, width: 13.6, height: 21.6, rx: 4.6 }, "ink"),
    el("rect", { x: x - 4.8, y: 38.8, width: 4.6, height: 4.6, rx: 1.4 }, "white", { shine: true }),
    shine(x + 2.8, 53, 1.4)
  ],
  // A mismatched pair: one wide eye, one small under a raised brow.
  mixed: (x, out) => (out < 0
    ? [...glossy(x, { rx: 11.8, ry: 14.6, irx: 8.8, iry: 11, dy: 1.6 }), shine(x - 3.2, 41.6, 3.6), shine(x + 3.6, 51, 1.6), lash(x, out, 46, 11.8, 14.6)]
    : [
      ...glossy(x, { cy: 49, rx: 8.4, ry: 10, irx: 6, iry: 7.6, dy: 1.4 }),
      shine(x - 2, 46.4, 2.4),
      lash(x, out, 49, 8.4, 10, 3),
      stroke(`M${x - 8} 31 Q${x} 25 ${x + 9} 30`, 3.6)
    ]),
  // Misty: a band of mist drifting across the eyes, held there.
  misty: (x, out) => [
    ...glossy(x),
    shine(x - 3, 41.8, 3.4),
    shine(x + 3.5, 51, 1.6),
    el("rect", { x: x - 13, y: 47.5, width: 26, height: 5.4, rx: 2.7 }, "body", { opacity: 0.75 }),
    lash(x, out, 46, 10.8, 14.4)
  ],
  // Rainbow glints arching over the iris.
  prism: (x, out) => [
    ...glossy(x),
    ...[RAINBOW[0], SUN, RAINBOW[3]].map((color, index) => el("path", { d: `M${x - 7 + index * 1.6} 45 A${5.6 - index * 1.6} ${5.6 - index * 1.6} 0 0 1 ${x + 4.2 - index * 1.6} 45`, fill: "none", "stroke-width": 1.7, "stroke-linecap": "round" }, "fixed", { color, shine: true })),
    shine(x + 3.6, 52, 1.5),
    lash(x, out, 46, 10.8, 14.4)
  ],
  // Sunny: a little sun shining in each eye.
  sunny: (x, out) => [
    ...glossy(x),
    shine(x - 3, 42, 2.6),
    { ...stroke(`M${x - 3} 36.4 L${x - 3} 37.6 M${x - 3} 46.4 L${x - 3} 47.6 M${x - 8.6} 42 L${x - 7.4} 42 M${x + 1.4} 42 L${x + 2.6} 42 M${x - 7} 38 L${x - 6.2} 38.8 M${x + 0.2} 45.2 L${x + 1} 46 M${x - 7} 46 L${x - 6.2} 45.2 M${x + 0.2} 38.8 L${x + 1} 38`, 1.3, "white"), shine: true },
    shine(x + 3.6, 51.4, 1.4),
    lash(x, out, 46, 10.8, 14.4)
  ],
  // Moonlit: crescent-moon glints.
  moon: (x, out) => [
    ...glossy(x),
    el("path", { d: `M${x - 1.6} 37 A5.4 5.4 0 1 0 ${x + 0.6} 46.4 A4.2 4.2 0 0 1 ${x - 1.6} 37 Z` }, "white", { shine: true }),
    shine(x + 3.6, 51.4, 1.6),
    lash(x, out, 46, 10.8, 14.4)
  ],
  // Dizzy spirals, from being spun about.
  spiral: (x, out) => [oval(x, 46, 10.8, 13.2, "white"), { ...stroke(spiralPath(x, 46.5), 2.3, "ink"), moves: true }, lash(x, out, 46, 10.8, 13.2)]
};

export const EYE_STYLES = Object.keys(EYES);

// Which parts of an eye look around: the iris and everything on it. The white, lids, lashes and
// cheeks stay put.
const moves = (part) => part.moves || part.shine || part.paint === "ink" || (part.paint === "body" && part.tag === "ellipse") || (part.paint === "bead" && part.tag !== "path");

// One eye in three layers: what lies under the iris (the white, which also clips the iris so it can
// glance to the edge), the iris itself, and what lies over it (lids, lashes, cheeks).
export function eyeParts(x, style = "plain") {
  const parts = (EYES[style] || EYES.plain)(x, x < 50 ? -1 : 1);
  const first = parts.findIndex(moves);
  const last = parts.length - 1 - [...parts].reverse().findIndex(moves);
  const under = parts.slice(0, first);
  return {
    under,
    pupil: parts.slice(first, last + 1),
    over: parts.slice(last + 1),
    clip: under[0]?.paint === "white" ? under[0] : null
  };
}

// The home's Builder, and only the Builder, wears a propeller beanie (D-44). Drawn with its brim's
// middle at (0, 0); MercbotAvatar places it at the shape's `hat`. Its colours are its own.
export const HAT = [
  { tag: "path", attrs: { d: "M-17 0 A17 16 0 0 1 17 0 Z", fill: BEANIE.yellow } },
  { tag: "path", attrs: { d: "M-6.5 0 Q-6 -11 0 -16 Q6 -11 6.5 0 Z", fill: BEANIE.blue } },
  { tag: "rect", attrs: { x: -19, y: -3.5, width: 38, height: 7, rx: 3.5, fill: BEANIE.red } },
  { tag: "rect", attrs: { x: -1.5, y: -22, width: 3, height: 7, rx: 1.5, fill: AVATAR_INK } },
  { tag: "ellipse", attrs: { cx: -8.5, cy: -22, rx: 8.5, ry: 3, fill: BEANIE.red } },
  { tag: "ellipse", attrs: { cx: 8.5, cy: -22, rx: 8.5, ry: 3, fill: BEANIE.blue } },
  { tag: "circle", attrs: { cx: 0, cy: -22, r: 2.6, fill: AVATAR_INK } }
];

// The Builder's pondering face keeps one eye narrowed under a held lid (never moving).
export const builderLid = (x) => lid(x, 46, 11.4, 14.8, 41, 41, 2.5);
