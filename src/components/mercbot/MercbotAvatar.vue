<script setup>
import { computed, useId } from "vue";
import { useTheme } from "vuetify";
import { AVATAR_BLUSH, AVATAR_INK, AVATAR_TEAR, ON_IDENTITY } from "@/theme/palettes.js";
import { isBlack, resolveBotColor } from "./accent.js";
import { HAT, builderLid, eyeParts, shapeById } from "./avatarShapes.js";
import { builderBotId } from "./builderBot.js";

// Our own bot avatar (D-44): a cloud in the bot's colour with two manga eyes of the cloud's own kind
// (avatarShapes.js). The cloud never moves and the eyes never blink or close: only the irises and
// their sparkles look around inside the eyes. States: idle (occasional glances left, right, up and
// down, out of step from bot to bot), hover and settled (looking at you), attention (sparkles
// twinkling), thinking (looking up, wondering), working (glancing side to side), concentrating
// (looking down at the work), happy (^ ^ eyes and rosy cheeks), asleep (dimmed, looking down, a
// "z"). `still` holds the eyes centred (the header chip, pickers). The home's Builder alone wears a
// propeller beanie and keeps a pondering face: a raised brow over one narrowed eye, its gaze turning
// slowly from one side to the other.
const props = defineProps({
  bot: { type: Object, required: true },
  size: { type: Number, default: 22 },
  state: { type: String, default: "idle" },
  still: { type: Boolean, default: false }
});

const EYE_X = [36, 64];
const uid = useId().replace(/[^\w-]/gu, "");

const theme = useTheme();
const colors = computed(() => resolveBotColor(props.bot.color, theme.current.value.colors));
// Lines and solid eyes are ink, or white on a black cloud in the light theme.
const line = computed(() => (isBlack(props.bot.color) && !theme.current.value.dark ? ON_IDENTITY : AVATAR_INK));
const mood = computed(() => (props.still ? "idle" : props.state));
const shape = computed(() => shapeById(props.bot.shape));
const eyeShift = computed(() => `translate(0 ${(shape.value.eyeY || 46) - 46})`);
const thinker = computed(() => Boolean(builderBotId.value) && String(props.bot.id) === String(builderBotId.value));
const eyes = computed(() => EYE_X.map((x) => ({ x, ...eyeParts(x, shape.value.eyes), clipId: `${uid}-eye-${x}` })));
const hat = computed(() => {
  const [x, y, tilt] = shape.value.hat || [50, 16, 0];
  return `translate(${x} ${y}) rotate(${tilt})`;
});

const PAINTS = { white: () => ON_IDENTITY, ink: () => AVATAR_INK, bead: () => line.value, body: () => colors.value.primary, blush: () => AVATAR_BLUSH, tear: () => AVATAR_TEAR };
function paint(part) {
  const color = part.color || PAINTS[part.paint]();
  const opacity = part.opacity ?? (part.paint === "blush" ? 0.6 : undefined);
  return part.attrs.fill === "none" ? { stroke: color, opacity } : { fill: color, opacity };
}

// A part of the cloud: its colour, unless it keeps its own (a rainbow, the sun) or is ink (a mouth);
// weather lines are strokes.
function bodyPaint(part) {
  const color = part.color === "ink" ? line.value : part.color || colors.value.primary;
  return part.line ? { fill: "none", stroke: color, "stroke-linecap": "round", "stroke-linejoin": "round" } : { fill: color };
}

// Each bot glances on its own rhythm.
const rhythm = computed(() => {
  const key = String(props.bot.id ?? props.bot.name ?? "");
  const hash = [...key].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) % 9973, 7);
  return { "--mb-gaze-delay": `-${hash % 13}s`, "--mb-gaze-duration": `${11 + (hash % 7)}s` };
});
</script>

<template>
  <svg
    class="mb-face"
    :class="[`mb-face--${mood}`, { 'mb-face--still': still, 'mb-face--builder': thinker }]"
    :style="rhythm"
    :width="size"
    :height="size"
    :viewBox="thinker ? '-10 -14 120 120' : '0 0 100 100'"
    aria-hidden="true"
  >
    <defs>
      <clipPath v-for="eye in eyes.filter((entry) => entry.clip)" :id="eye.clipId" :key="eye.clipId">
        <component :is="eye.clip.tag" v-bind="eye.clip.attrs" />
      </clipPath>
    </defs>
    <g class="mb-face__body">
      <component :is="part.tag" v-for="(part, index) in shape.parts" :key="index" v-bind="{ ...part.attrs, ...bodyPaint(part) }" />
      <g class="mb-face__eyes" :transform="eyeShift">
        <ellipse v-for="x in EYE_X" :key="`blush-${x}`" class="mb-face__blush" :cx="x < 50 ? 25 : 75" cy="61" rx="6.5" ry="3.6" :fill="AVATAR_BLUSH" />
        <g v-for="eye in eyes" :key="eye.x" class="mb-face__eye">
          <component :is="part.tag" v-for="(part, index) in eye.under" :key="`u${index}`" v-bind="{ ...part.attrs, ...paint(part) }" />
          <g :clip-path="eye.clip ? `url(#${eye.clipId})` : undefined">
            <g class="mb-face__pupil">
              <component
                :is="part.tag"
                v-for="(part, index) in eye.pupil"
                :key="`p${index}`"
                :class="{ 'mb-face__shine': part.shine }"
                v-bind="{ ...part.attrs, ...paint(part) }"
              />
            </g>
          </g>
          <component :is="part.tag" v-for="(part, index) in eye.over" :key="`o${index}`" v-bind="{ ...part.attrs, ...paint(part) }" />
          <template v-if="thinker && eye.x > 50">
            <component :is="part.tag" v-for="(part, index) in builderLid(eye.x)" :key="`b${index}`" v-bind="{ ...part.attrs, ...paint(part) }" />
          </template>
        </g>
        <path class="mb-face__smile" d="M27 50 Q36 37 45 50 M55 50 Q64 37 73 50" fill="none" :stroke="line" stroke-width="5.5" stroke-linecap="round" />
        <path v-if="thinker" class="mb-face__brow" d="M54 25 Q64 18 74 23" fill="none" :stroke="line" stroke-width="5" stroke-linecap="round" />
      </g>
    </g>
    <g v-if="thinker" class="mb-face__hat" :transform="hat">
      <component :is="part.tag" v-for="(part, index) in HAT" :key="index" v-bind="part.attrs" />
    </g>
    <text v-if="mood === 'asleep'" class="mb-face__zz" x="80" y="18" :fill="colors.primary">z</text>
  </svg>
</template>

<style scoped>
.mb-face {
  flex: none;
  overflow: visible;
}

/* Only the irises move; the cloud, the whites of the eyes, lids and lashes never do. */
.mb-face__pupil {
  transition: transform 0.35s ease;
}

.mb-face__shine {
  transform-box: fill-box;
  transform-origin: center;
}

.mb-face__eye,
.mb-face__smile,
.mb-face__blush {
  transition: opacity 0.25s ease;
}

.mb-face__smile,
.mb-face__blush {
  opacity: 0;
}

/* Idle: now and then a glance left, right, up or down, with pauses in between. */
.mb-face--idle:not(.mb-face--still) .mb-face__pupil {
  animation: mb-look-around var(--mb-gaze-duration, 13s) ease-in-out infinite;
  animation-delay: var(--mb-gaze-delay, 0s);
}

/* The Builder ponders: gaze up to one side, turning slowly to the other. */
.mb-face--builder.mb-face--idle .mb-face__pupil {
  transform: translate(-3px, -3px);
}

.mb-face--builder.mb-face--idle:not(.mb-face--still) .mb-face__pupil {
  animation: mb-ponder 8s ease-in-out infinite;
}

/* Hover and settled: looking at you. */
.mb-face--hover .mb-face__pupil,
.mb-face--settled .mb-face__pupil {
  transform: translate(0, 0.5px);
}

/* Attention: the sparkles twinkle. */
.mb-face--attention .mb-face__shine {
  animation: mb-twinkle 1.4s ease-in-out infinite;
}

/* Thinking: looking up, wondering from side to side. */
.mb-face--thinking .mb-face__pupil {
  transform: translate(-2.5px, -3px);
  animation: mb-wonder 2.6s ease-in-out infinite;
}

/* Working: glancing left and right. */
.mb-face--working .mb-face__pupil {
  animation: mb-glance 1.4s ease-in-out infinite;
}

/* Concentrating: looking down at the work. */
.mb-face--concentrating .mb-face__pupil {
  transform: translate(0, 3px);
}

/* Happy: ^ ^ eyes and rosy cheeks, held while happy. */
.mb-face--happy .mb-face__eye {
  opacity: 0;
}

.mb-face--happy .mb-face__smile {
  opacity: 1;
}

.mb-face--happy .mb-face__blush {
  opacity: 0.55;
}

/* Asleep: the cloud dimmed, eyes looking down, a small "z". */
.mb-face--asleep .mb-face__body {
  opacity: 0.55;
}

.mb-face--asleep .mb-face__pupil {
  transform: translate(0, 3px);
}

.mb-face__zz {
  font: 700 26px var(--v-font-body);
  animation: mb-float 2.4s ease-in-out infinite;
}

@keyframes mb-look-around {
  0%, 14% { transform: translate(0, 0); }
  18%, 30% { transform: translate(-3px, 0); }
  34%, 44% { transform: translate(0, 0); }
  48%, 58% { transform: translate(3px, 0); }
  62%, 70% { transform: translate(1px, -3px); }
  74%, 82% { transform: translate(0, 0); }
  86%, 93% { transform: translate(0, 2.5px); }
  97%, 100% { transform: translate(0, 0); }
}

@keyframes mb-ponder {
  0%, 38% { transform: translate(-3px, -3px); }
  50%, 88% { transform: translate(3px, -3.5px); }
  100% { transform: translate(-3px, -3px); }
}

@keyframes mb-wonder {
  0%, 100% { transform: translate(-2.5px, -3px); }
  50% { transform: translate(2.5px, -3.5px); }
}

@keyframes mb-glance {
  0%, 100% { transform: translate(-3px, 0); }
  50% { transform: translate(3px, 0); }
}

@keyframes mb-twinkle {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.35); }
}

@keyframes mb-float {
  0%, 100% { transform: translateY(0); opacity: 0.5; }
  50% { transform: translateY(-6px); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .mb-face *,
  .mb-face {
    animation: none !important;
  }
}
</style>
