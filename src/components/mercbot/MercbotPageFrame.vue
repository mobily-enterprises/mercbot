<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { watchElementVisible } from "@/browser.js";
import { pagesApi } from "./filesApi.js";
import { readPageMessage } from "./pageMessages.js";

// A bot's HTML page, sealed (D-40, D-74): framed from its page-only address in a sandbox without
// allow-same-origin, so it has no origin of its own, and credentialless, so nothing it loads carries
// the person's cookies. It talks to Mercbot only through its helper's messages, each checked here:
// sent by this frame, from no origin ("null"), and of exactly one known shape. A link it asks for opens
// in a new tab, and an app (the doorway) is handed to the viewer, only right after the person clicked.
// `preview` is a card's look at its top: loaded once in sight, never answered.
const props = defineProps({
  botId: { type: String, required: true },
  path: { type: String, required: true },
  preview: { type: Boolean, default: false }
});
const emit = defineEmits(["open-app", "failure", "loaded"]);

const holder = ref(null);
const frame = ref(null);
const src = ref("");
const height = ref(0);
const problem = ref("");

async function load() {
  problem.value = "";
  src.value = "";
  try {
    src.value = (await pagesApi.frame(props.botId, props.path)).src;
  } catch (error) {
    src.value = "";
    problem.value = error?.status === 404 ? "This page isn't here any more." : "This page can't be shown right now.";
  }
}

// Something the person just did inside the page (a click or a key) lets it open a link or an app:
// the page has the focus, so the click was in it, not the one in Mercbot that opened the page, and
// the click is still fresh.
const justActed = () => document.activeElement === frame.value && (!navigator.userActivation || navigator.userActivation.isActive);

function onMessage(event) {
  if (props.preview || !frame.value || event.source !== frame.value.contentWindow || event.origin !== "null") return;
  const message = readPageMessage(event.data);
  if (!message) return;
  if (message.kind === "height") height.value = message.height;
  else if (message.kind === "ticks") pagesApi.tick(props.botId, props.path, message.items).catch((error) => emit("failure", error));
  else if (message.kind === "link" && justActed()) window.open(message.href, "_blank", "noopener,noreferrer");
  else if (message.kind === "open-app" && justActed()) emit("open-app", message);
}

let stopWatching = () => {};
onMounted(() => {
  window.addEventListener("message", onMessage);
  if (!props.preview) {
    load();
    return;
  }
  stopWatching = watchElementVisible(holder.value, (visible) => {
    if (!visible) return;
    stopWatching();
    load();
  });
});
onBeforeUnmount(() => {
  window.removeEventListener("message", onMessage);
  stopWatching();
});
watch(() => [props.botId, props.path], () => {
  height.value = 0;
  load();
});

defineExpose({ reload: load });
</script>

<template>
  <div ref="holder" class="mb-page-frame" :class="{ 'mb-page-frame--preview': preview }">
    <p v-if="problem" class="mb-page-frame__problem">{{ problem }}</p>
    <iframe
      v-else-if="src"
      ref="frame"
      :key="src"
      class="mb-page-frame__frame"
      :src="src"
      :title="preview ? '' : 'Page'"
      sandbox="allow-scripts"
      credentialless
      referrerpolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; clipboard-read 'none'; clipboard-write 'none'"
      :tabindex="preview ? -1 : undefined"
      :aria-hidden="preview ? 'true' : undefined"
      :style="preview || !height ? undefined : { height: `${height}px` }"
      @load="emit('loaded')"
    />
  </div>
</template>

<style scoped>
.mb-page-frame {
  width: 100%;
}

.mb-page-frame__frame {
  display: block;
  width: 100%;
  height: 70vh;
  min-height: 240px;
  border: 0;
}

/* A card's look at the page's top: the page as it is at 900 px wide, shown at a third of that. */
.mb-page-frame--preview {
  width: 300px;
  height: 160px;
  overflow: hidden;
}

.mb-page-frame--preview .mb-page-frame__frame {
  width: 900px;
  height: 480px;
  min-height: 0;
  transform: scale(0.3333);
  transform-origin: top left;
}

.mb-page-frame__problem {
  margin: 0;
  padding: 24px;
  color: rgb(var(--v-theme-on-surface-variant));
  font-size: 14px;
}
</style>
