<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import MercbotAvatar from "./MercbotAvatar.vue";
import { BOT_COLOURS, INTRO_SCENE, ONBOARDING_BLACK } from "@/theme/palettes.js";

// First-run intro slides: Enter or → goes on, ← goes back.
const emit = defineEmits(["finish"]);
const slide = ref(0);
// Each slide's name for screen readers and its title, in one line or three: the page's one h1.
const SLIDES = [
  { key: "meet", label: "Meet your bot", lines: ["Say hello to Mercbot"] },
  { key: "computer", label: "Its own computer", lines: ["Mercbot gets its own computer", "and gets on with the work,", "just like you would"] },
  { key: "team", label: "Give each bot a job", lines: ["Give each bot a job"] }
];
const current = computed(() => SLIDES[slide.value]);
const promptIndex = ref(0);
const demoVisible = ref(true);
const labelsVisible = ref(false);
const mainBot = { name: "Mercbot", color: ONBOARDING_BLACK };
const PROMPTS = [
  "Sort out my inbox before Monday",
  "Find a time for lunch with Sam next week",
  "Chase the invoices that are overdue",
  "Summarise yesterday's meeting notes"
];
const TEAM = [
  { name: "Sam", color: BOT_COLOURS.Red, job: "Weekly sales report", place: "top" },
  { name: "Ivy", color: BOT_COLOURS.Teal, job: "Inbox triage", place: "left" },
  { name: "Leo", color: BOT_COLOURS.Blue, job: "Invoice follow-ups", place: "right" }
];
// The picture's own colours, for its CSS.
const sceneColours = {
  "--mb-scene-sky-from": INTRO_SCENE.skyFrom,
  "--mb-scene-sky-to": INTRO_SCENE.skyTo,
  "--mb-scene-dots": INTRO_SCENE.dots,
  "--mb-scene-window": INTRO_SCENE.window,
  "--mb-scene-window-bar": INTRO_SCENE.windowBar,
  "--mb-scene-window-line": INTRO_SCENE.windowLine
};

let timers = [];
function clearTimers() {
  timers.forEach((timer) => clearTimeout(timer) || clearInterval(timer));
  timers = [];
}

watch(slide, (value) => {
  clearTimers();
  if (value === 0) {
    promptIndex.value = 0;
    demoVisible.value = true;
    timers.push(setInterval(() => { promptIndex.value = (promptIndex.value + 1) % PROMPTS.length; }, 2000));
    timers.push(setTimeout(() => { demoVisible.value = false; }, 8000));
  } else if (value === 2) {
    labelsVisible.value = false;
    timers.push(setTimeout(() => { labelsVisible.value = true; }, 4000));
  }
}, { immediate: true });

function next() {
  if (slide.value < 2) slide.value += 1;
  else emit("finish");
}

function previous() {
  if (slide.value > 0) slide.value -= 1;
}

function onKeydown(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (event.key === "ArrowRight" || (event.key === "Enter" && event.target === document.body)) {
    event.preventDefault();
    next();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    previous();
  }
}

onMounted(() => window.addEventListener("keydown", onKeydown));
onBeforeUnmount(() => {
  clearTimers();
  window.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div class="mb-intro">
    <div class="mb-intro__stage">
      <section :key="current.key" class="mb-intro__slide" :aria-label="current.label">
        <h1 class="mb-intro__title" :class="current.lines.length > 1 ? 'mb-intro__title--three-lines' : 'mb-intro__title--one-line'"><template v-for="(line, index) in current.lines" :key="index"><br v-if="index">{{ line }}</template></h1>
        <template v-if="slide === 0">
          <div class="mb-intro__meet-avatar"><MercbotAvatar :bot="mainBot" :size="58" /></div>
          <Transition name="mb-fade">
            <div v-if="demoVisible" class="mb-intro__demo" aria-hidden="true">
              <Transition name="mb-fade" mode="out-in">
                <span :key="promptIndex" class="mb-intro__demo-text">{{ PROMPTS[promptIndex] }}</span>
              </Transition>
              <span class="mb-intro__demo-plus">+</span>
              <span class="mb-intro__demo-send">↑</span>
            </div>
          </Transition>
        </template>
        <template v-else-if="slide === 1">
          <div class="mb-intro__scene" :style="sceneColours" aria-hidden="true">
            <div class="mb-intro__thinking"><span /><span /><span /></div>
            <div class="mb-intro__window mb-intro__window--first">
              <div class="mb-intro__window-bar" />
              <div class="mb-intro__window-line" />
              <div class="mb-intro__window-line mb-intro__window-line--short" />
              <div class="mb-intro__cursor"><MercbotAvatar :bot="mainBot" :size="22" /></div>
            </div>
            <div class="mb-intro__window mb-intro__window--second">
              <div class="mb-intro__window-bar" />
              <div class="mb-intro__window-line" />
              <div class="mb-intro__window-line" />
              <div class="mb-intro__window-line mb-intro__window-line--short" />
            </div>
          </div>
        </template>
        <template v-else>
          <div class="mb-intro__team">
            <div v-for="member in TEAM" :key="member.name" class="mb-intro__member" :class="`mb-intro__member--${member.place}`">
              <MercbotAvatar :bot="member" :size="74" />
              <Transition name="mb-fade">
                <span v-if="labelsVisible" class="mb-intro__job">{{ member.job }}</span>
              </Transition>
            </div>
          </div>
        </template>
      </section>

      <button type="button" class="mb-intro__button mb-intro__button--next" @click="next">Next</button>
      <button v-if="slide > 0" type="button" class="mb-intro__button mb-intro__button--previous" @click="previous">Previous</button>
    </div>
  </div>
</template>

<style scoped>
.mb-intro {
  position: fixed;
  inset: 0;
  overflow: auto;
  background: rgb(var(--v-theme-background));
  color: rgb(var(--v-theme-on-background));
}

.mb-intro__stage {
  position: relative;
  height: 760px;
  margin-top: max(0px, calc((100vh - 760px) / 2));
}

.mb-intro__title {
  position: absolute;
  right: 0;
  left: 0;
  margin: 0;
  font-size: 30px;
  font-weight: 400;
  line-height: 37px;
  text-align: center;
}

.mb-intro__title--one-line {
  top: 100px;
}

.mb-intro__title--three-lines {
  top: 70px;
}

.mb-intro__meet-avatar {
  position: absolute;
  top: 270px;
  left: 50%;
  transform: translateX(-50%);
}

.mb-intro__demo {
  position: absolute;
  top: 358px;
  left: 50%;
  width: 344px;
  height: 80px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 16px;
  background: rgb(var(--v-theme-surface));
  box-shadow: var(--mb-shadow-soft);
  transform: translateX(-50%);
}

.mb-intro__demo-text {
  position: absolute;
  top: 12px;
  left: 14px;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-intro__demo-plus,
.mb-intro__demo-send {
  position: absolute;
  bottom: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  font-size: 14px;
}

.mb-intro__demo-plus {
  left: 10px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-intro__demo-send {
  right: 10px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.mb-intro__scene {
  position: absolute;
  top: 200px;
  left: 50%;
  width: 440px;
  height: 300px;
  overflow: hidden;
  border-radius: 16px;
  background: linear-gradient(135deg, var(--mb-scene-sky-from), var(--mb-scene-sky-to));
  box-shadow: 0 12px 32px rgba(var(--v-theme-shadow), 0.12);
  transform: translateX(-50%);
}

.mb-intro__thinking {
  position: absolute;
  top: 136px;
  left: 196px;
  display: flex;
  gap: 6px;
  animation: mb-hide 0.3s ease 1.5s forwards;
}

.mb-intro__thinking span {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--mb-scene-dots);
  animation: mb-pulse 0.9s ease-in-out infinite;
}

.mb-intro__thinking span:nth-child(2) { animation-delay: 0.15s; }
.mb-intro__thinking span:nth-child(3) { animation-delay: 0.3s; }

.mb-intro__window {
  position: absolute;
  width: 240px;
  height: 160px;
  padding: 0 14px;
  border-radius: 10px;
  background: var(--mb-scene-window);
  box-shadow: 0 6px 18px rgba(var(--v-theme-shadow), 0.12);
  opacity: 0;
}

.mb-intro__window--first {
  top: 50px;
  left: 40px;
  animation: mb-appear 0.4s ease 1.6s forwards;
}

.mb-intro__window--second {
  top: 100px;
  left: 170px;
  animation: mb-slide-in 0.6s ease-out 3.6s forwards;
}

.mb-intro__window-bar {
  height: 22px;
  margin: 0 -14px 14px;
  border-radius: 10px 10px 0 0;
  background: var(--mb-scene-window-bar);
}

.mb-intro__window-line {
  height: 10px;
  margin-bottom: 10px;
  border-radius: 5px;
  background: var(--mb-scene-window-line);
}

.mb-intro__window-line--short {
  width: 60%;
}

.mb-intro__cursor {
  position: absolute;
  top: 40px;
  left: 30px;
  animation: mb-roam 1.8s ease-in-out 1.9s forwards;
}

.mb-intro__team {
  position: absolute;
  top: 224px;
  left: 50%;
  width: 423px;
  height: 260px;
  transform: translateX(-50%);
}

.mb-intro__member {
  position: absolute;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}

.mb-intro__member--top { top: 0; left: 50%; transform: translateX(-50%); }
.mb-intro__member--left { bottom: 0; left: 0; }
.mb-intro__member--right { right: 0; bottom: 0; }

.mb-intro__job {
  padding: 4px 14px;
  border-radius: 999px;
  background: rgb(var(--v-theme-surface-container-high));
  font-size: 20px;
  line-height: 28px;
  white-space: nowrap;
}

.mb-intro__button {
  position: absolute;
  left: 50%;
  width: 288px;
  height: 36px;
  border: 0;
  border-radius: 18px;
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transform: translateX(-50%);
}

.mb-intro__button:focus-visible {
  outline: 2px solid rgb(var(--v-theme-secondary));
  outline-offset: 2px;
}

.mb-intro__button--next {
  top: 572px;
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.mb-intro__button--next:hover {
  background: rgb(var(--v-theme-primary));
}

.mb-intro__button--previous {
  top: 620px;
  background: rgb(var(--v-theme-surface-container-high));
  color: rgb(var(--v-theme-on-surface));
}

.mb-fade-enter-active,
.mb-fade-leave-active {
  transition: opacity 0.4s ease;
}

.mb-fade-enter-from,
.mb-fade-leave-to {
  opacity: 0;
}

@keyframes mb-pulse {
  0%, 100% { opacity: 0.4; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-3px); }
}

@keyframes mb-hide { to { opacity: 0; } }
@keyframes mb-appear { to { opacity: 1; } }

@keyframes mb-slide-in {
  from { opacity: 1; transform: translateX(220px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes mb-roam {
  0% { transform: translate(0, 0); }
  50% { transform: translate(120px, 30px); }
  100% { transform: translate(70px, 80px); }
}

@media (prefers-reduced-motion: reduce) {
  .mb-intro__thinking,
  .mb-intro__thinking span,
  .mb-intro__cursor {
    animation: none;
  }

  .mb-intro__window--first,
  .mb-intro__window--second {
    animation: none;
    opacity: 1;
  }
}
</style>
