<script setup>
import { nextTick, onBeforeUnmount, ref } from "vue";
import { accountApi, refusedWork } from "./accountApi.js";
import { photoFrom, photoFromFile } from "./vaultPhoto.js";

// Scan with camera and Upload a photo, on the Vault's contact form: the images AI reads the
// contact details in a photo of a business card, a letter or another document (packages/account
// vaultPhoto.js), and they fill the form for the person to check before saving. The camera is on
// only while its view shows, and Mercbot keeps the photo nowhere. Cards are never read from a photo:
// their numbers never go to an AI.
const emit = defineEmits(["read"]);

const camera = ref(false);
const reading = ref(false);
const error = ref("");
const video = ref(null);
const picker = ref(null);
let stream = null;

function stopCamera() {
  for (const track of stream?.getTracks() || []) track.stop();
  stream = null;
  camera.value = false;
}
onBeforeUnmount(stopCamera);

async function startCamera() {
  error.value = "";
  if (!navigator.mediaDevices?.getUserMedia) {
    error.value = "This browser can't use a camera here. Upload a photo instead.";
    return;
  }
  // The view shows at once, so Cancel works while the browser asks. A camera that starts after
  // Cancel or after the form closed, or beside one already showing, is turned off at once.
  camera.value = true;
  try {
    const started = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
    if (!camera.value || stream) {
      for (const track of started.getTracks()) track.stop();
      return;
    }
    stream = started;
    await nextTick();
    video.value.srcObject = stream;
  } catch (failure) {
    stopCamera();
    error.value = failure?.name === "NotAllowedError"
      ? "Mercbot isn't allowed to use your camera. Allow it in your browser, or upload a photo instead."
      : "Your camera couldn't be started. Upload a photo instead.";
  }
}

async function read(photo) {
  reading.value = true;
  try {
    const { fields } = await accountApi.readVaultPhoto(photo);
    emit("read", fields);
  } catch (failure) {
    refusedWork(failure);
    error.value = failure?.message || "That photo couldn't be read. Type the details in instead.";
  } finally {
    reading.value = false;
  }
}

async function takePhoto() {
  const frame = video.value;
  if (!frame?.videoWidth) {
    error.value = "The camera isn't showing anything yet. Try again in a moment.";
    return;
  }
  error.value = "";
  const photo = await photoFrom(frame, frame.videoWidth, frame.videoHeight);
  stopCamera();
  await read(photo);
}

async function chooseFile(event) {
  const [file] = event.target.files || [];
  event.target.value = "";
  if (!file) return;
  error.value = "";
  let photo;
  try {
    photo = await photoFromFile(file);
  } catch {
    error.value = "That photo couldn't be opened. Choose a JPEG, PNG or WebP picture.";
    return;
  }
  await read(photo);
}
</script>

<template>
  <div class="mb-photo">
    <div v-if="camera" class="mb-photo__camera">
      <video ref="video" class="mb-photo__video" autoplay playsinline muted aria-label="Camera view" />
      <div class="mb-photo__actions">
        <button type="button" class="mb-set-pill" @click="stopCamera">Cancel</button>
        <button type="button" class="mb-set-pill mb-set-pill--dark" @click="takePhoto"><v-icon icon="$photoCameraFilled" size="14" /> Take photo</button>
      </div>
    </div>
    <div v-else class="mb-photo__pair">
      <button type="button" class="mb-set-pill" :disabled="reading" @click="startCamera"><v-icon icon="$photoCameraFilled" size="14" /> Scan with camera</button>
      <button type="button" class="mb-set-pill" :disabled="reading" @click="picker.click()"><v-icon icon="$image" size="14" /> Upload a photo</button>
      <input ref="picker" type="file" accept="image/*" class="mb-photo__picker" aria-label="Photo to read" @change="chooseFile">
    </div>
    <p v-if="reading" class="mb-photo__note" role="status">Reading the photo…</p>
    <p v-else-if="error" class="mb-photo__error" role="alert">{{ error }}</p>
    <p v-else class="mb-photo__note">A photo of a business card, a letter or another document. Google's Gemini reads it; Mercbot doesn't keep the photo.</p>
  </div>
</template>

<style scoped>
.mb-photo {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mb-photo__pair,
.mb-photo__actions {
  display: flex;
  gap: 10px;
}

.mb-photo__actions {
  justify-content: flex-end;
}

.mb-photo__camera {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mb-photo__video {
  width: 100%;
  max-height: 260px;
  border-radius: 8px;
  background: rgb(var(--v-theme-surface-container-high));
  object-fit: contain;
}

.mb-photo__picker {
  display: none;
}

.mb-photo__note,
.mb-photo__error {
  margin: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-photo__error {
  color: rgb(var(--v-theme-error));
}
</style>
