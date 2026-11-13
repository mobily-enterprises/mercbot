<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { computerApi } from "./computerApi.js";

// A bot's whole desktop over VNC (D-13), scaled to fit. View-only unless `control` is on;
// in control, the person's mouse and keys go through the same connection.
const props = defineProps({
  // A bot's id, or { id, group } for its own computer in a group (D-46).
  botId: { type: [String, Object], required: true },
  awake: { type: Boolean, default: false },
  control: { type: Boolean, default: false }
});
const emit = defineEmits(["connected", "disconnected"]);

const target = ref(null);

// noVNC checks a channel's properties on its own prototype only; some browsers (like the
// preview's) subclass WebSocket, so hand it a plain object that forwards to the real socket.
function socketChannel(url) {
  const socket = new WebSocket(url, ["binary"]);
  const channel = {
    send: (data) => socket.send(data),
    close: (...args) => socket.close(...args)
  };
  for (const prop of ["binaryType", "onerror", "onmessage", "onopen", "onclose"]) {
    Object.defineProperty(channel, prop, { enumerable: true, get: () => socket[prop], set: (value) => { socket[prop] = value; } });
  }
  for (const prop of ["protocol", "readyState", "url", "bufferedAmount"]) {
    Object.defineProperty(channel, prop, { enumerable: true, get: () => socket[prop] });
  }
  return channel;
}
// A connection that doesn't come up is retried a few times, then shown as failed with a Retry.
const TICKET_MS = 8000;
const HANDSHAKE_MS = 15000;
const ATTEMPTS = 3;
const connected = ref(false);
const failed = ref(false);
let rfb = null;
let connecting = false;
let retryTimer = null;
let handshakeTimer = null;
let attempts = 0;

function withTimeout(promise, ms) {
  return Promise.race([promise, new Promise((_resolve, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);
}

function tryAgainLater(delay) {
  attempts += 1;
  if (attempts >= ATTEMPTS) failed.value = true;
  else retryTimer = setTimeout(connect, delay);
}

// "Connected" means the desktop is actually showing: wait for a first non-blank frame.
function firstFrame() {
  return new Promise((resolve) => {
    const started = Date.now();
    const check = () => {
      const canvas = target.value?.querySelector("canvas");
      let drawn = false;
      try {
        const context = canvas?.getContext("2d");
        for (const [x, y] of [[0.5, 0.5], [0.25, 0.25], [0.75, 0.75], [0.5, 0.1]]) {
          const [r, g, b] = context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data;
          if (r + g + b > 60) drawn = true;
        }
      } catch {
        drawn = false;
      }
      if (drawn || Date.now() - started > 5000 || !rfb) resolve();
      else setTimeout(check, 150);
    };
    check();
  });
}

function retry() {
  failed.value = false;
  attempts = 0;
  connect();
}

async function connect() {
  if (rfb || connecting || failed.value || !props.awake || !target.value) return;
  connecting = true;
  try {
    // noVNC (about 180 KB) loads with the first screen shown, not with every page of the home.
    const [{ ticket }, { default: RFB }] = await Promise.all([withTimeout(computerApi.ticket(props.botId), TICKET_MS), import("@novnc/novnc")]);
    const scheme = window.location.protocol === "https:" ? "wss" : "ws";
    rfb = new RFB(target.value, socketChannel(`${scheme}://${window.location.host}/api/computer-vnc?ticket=${ticket}`));
    rfb.scaleViewport = true;
    rfb.resizeSession = false;
    rfb.viewOnly = !props.control;
    rfb.focusOnClick = props.control;
    rfb.background = "transparent";
    const current = rfb;
    handshakeTimer = setTimeout(() => current.disconnect(), HANDSHAKE_MS);
    rfb.addEventListener("connect", async () => {
      clearTimeout(handshakeTimer);
      await firstFrame();
      if (rfb !== current) return;
      attempts = 0;
      connected.value = true;
      emit("connected");
    });
    rfb.addEventListener("disconnect", () => {
      clearTimeout(handshakeTimer);
      if (rfb !== current) return;
      rfb = null;
      const wasConnected = connected.value;
      connected.value = false;
      emit("disconnected");
      if (wasConnected) retryTimer = setTimeout(connect, 1500);
      else tryAgainLater(1500);
    });
  } catch {
    tryAgainLater(2000);
  } finally {
    connecting = false;
  }
}

function disconnect() {
  clearTimeout(retryTimer);
  clearTimeout(handshakeTimer);
  const current = rfb;
  rfb = null;
  current?.disconnect();
}

watch(() => props.control, (control) => {
  if (!rfb) return;
  rfb.viewOnly = !control;
  rfb.focusOnClick = control;
  if (control) rfb.focus();
});

watch(() => [props.botId, props.awake], ([, awake]) => {
  disconnect();
  failed.value = false;
  attempts = 0;
  if (awake) connect();
});

onMounted(connect);
onBeforeUnmount(disconnect);

defineExpose({ focus: () => rfb?.focus() });
</script>

<template>
  <v-theme-provider theme="dark" with-background class="mb-vnc">
    <div ref="target" class="mb-vnc__target" />
    <div v-if="failed" class="mb-vnc__waiting mb-vnc__waiting--failed" role="alert">
      <p>Couldn't reach the screen.</p>
      <button type="button" class="mb-vnc__retry" @click.stop="retry">Try again</button>
    </div>
    <div v-else-if="!connected" class="mb-vnc__waiting">
      <span class="mb-vnc__dots" aria-hidden="true"><span /><span /><span /></span>
      <p>{{ awake ? "Connecting to the screen…" : "Starting the desktop…" }}</p>
    </div>
  </v-theme-provider>
</template>

<style scoped>
.mb-vnc {
  position: relative;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: rgb(var(--v-theme-surface));
}

.mb-vnc__target {
  width: 100%;
  height: 100%;
}

.mb-vnc__waiting {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
  pointer-events: none;
}

.mb-vnc__waiting--failed {
  pointer-events: auto;
}

.mb-vnc__retry {
  height: 28px;
  padding: 0 14px;
  border: 0;
  border-radius: 14px;
  background: rgb(var(--v-theme-inverse-surface));
  font: inherit;
  font-size: 13px;
  color: rgb(var(--v-theme-inverse-on-surface));
  cursor: pointer;
}

.mb-vnc__waiting p {
  margin: 0;
}

.mb-vnc__dots {
  display: flex;
  gap: 5px;
}

.mb-vnc__dots span {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: rgb(var(--v-theme-on-surface-variant));
  animation: mb-vnc-dot 1s ease-in-out infinite;
}

.mb-vnc__dots span:nth-child(2) {
  animation-delay: 0.15s;
}

.mb-vnc__dots span:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes mb-vnc-dot {
  0%, 100% { opacity: 0.3; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-3px); }
}
</style>
