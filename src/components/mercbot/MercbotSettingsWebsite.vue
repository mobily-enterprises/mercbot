<script setup>
import { computed, onMounted, ref } from "vue";
import { errorText } from "@/components/apps/appsApi.js";
import MercbotConfirmDialog from "./MercbotConfirmDialog.vue";
import { websitesApi } from "./websitesApi.js";

// Settings → Website (D-84): the home's own website, where people publish the pages bots write. Pages are uploaded to a
// folder on this computer that a web server already serves, or to S3-compatible storage, and the website's address is
// where that place is served. Mercbot checks the folder or the bucket before saving. The storage's keys are never
// shown again: left empty, the saved ones stay. Owners and admins set it up; members see it. Only the people who run
// this copy are offered a folder on its computer.
const emit = defineEmits(["failure", "notify"]);
const current = ref(null);
const canManage = ref(false);
const canUseFolder = ref(false);
const kind = ref("folder");
const baseUrl = ref("");
const folder = ref("");
const endpoint = ref("");
const region = ref("");
const bucket = ref("");
const prefix = ref("");
const accessKeyId = ref("");
const secretAccessKey = ref("");
const saving = ref(false);
const problem = ref("");
const removing = ref(false);

const saved = computed(() => current.value?.website || null);

function show(answer) {
  current.value = answer;
  canManage.value = answer.canManage === true;
  canUseFolder.value = answer.canUseFolder === true;
  const website = answer.website || {};
  kind.value = website.kind || (canUseFolder.value ? "folder" : "s3");
  baseUrl.value = website.baseUrl || "";
  folder.value = website.folder || "";
  endpoint.value = website.endpoint || "";
  region.value = website.region || "";
  bucket.value = website.bucket || "";
  prefix.value = website.prefix || "";
  accessKeyId.value = "";
  secretAccessKey.value = "";
}

onMounted(async () => {
  try {
    show(await websitesApi.get());
  } catch (error) {
    emit("failure", error);
  }
});

function entered() {
  const place = kind.value === "folder"
    ? { folder: folder.value }
    : { endpoint: endpoint.value, region: region.value, bucket: bucket.value, prefix: prefix.value, accessKeyId: accessKeyId.value, secretAccessKey: secretAccessKey.value };
  return { kind: kind.value, baseUrl: baseUrl.value, ...place };
}

async function save() {
  saving.value = true;
  problem.value = "";
  try {
    show(await websitesApi.save(entered()));
    emit("notify", "Website saved");
  } catch (error) {
    problem.value = errorText(error, "That didn't work. Try again.");
  } finally {
    saving.value = false;
  }
}

async function remove() {
  problem.value = "";
  try {
    show(await websitesApi.remove());
    emit("notify", "Website removed");
  } catch (error) {
    problem.value = errorText(error, "That didn't work. Try again.");
  }
}
</script>

<template>
  <section v-if="current">
    <p class="mb-set-group">Where this home's pages are published</p>
    <fieldset class="mb-set-card mb-site-set__card" :disabled="!canManage || saving">
      <label v-if="canUseFolder || saved?.kind === 'folder'" class="mb-set-row mb-site-set__choice">
        <input v-model="kind" type="radio" value="folder" :disabled="!canUseFolder">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">A folder on this computer</span>
          <span class="mb-set-row__description">A folder a web server already serves. Each page goes in a folder of its own there.</span>
        </span>
      </label>
      <div v-if="kind === 'folder'" class="mb-set-row mb-site-set__form">
        <label class="mb-site-set__field">
          <span>Folder</span>
          <input v-model="folder" placeholder="/var/www/html/pages" autocomplete="off" spellcheck="false">
        </label>
      </div>
      <label class="mb-set-row mb-site-set__choice">
        <input v-model="kind" type="radio" value="s3">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">S3-compatible storage</span>
          <span class="mb-set-row__description">Amazon S3, Cloudflare R2, Backblaze B2, MinIO and the like. Each page goes in a folder of its own in the bucket.</span>
        </span>
      </label>
      <div v-if="kind === 's3'" class="mb-set-row mb-site-set__form">
        <label class="mb-site-set__field">
          <span>Endpoint</span>
          <input v-model="endpoint" placeholder="Empty for Amazon S3" autocomplete="off" spellcheck="false">
        </label>
        <div class="mb-site-set__pair">
          <label class="mb-site-set__field">
            <span>Bucket</span>
            <input v-model="bucket" autocomplete="off" spellcheck="false">
          </label>
          <label class="mb-site-set__field">
            <span>Region</span>
            <input v-model="region" placeholder="us-east-1" autocomplete="off" spellcheck="false">
          </label>
        </div>
        <label class="mb-site-set__field">
          <span>Folder in the bucket (optional)</span>
          <input v-model="prefix" placeholder="pages" autocomplete="off" spellcheck="false">
        </label>
        <div class="mb-site-set__pair">
          <label class="mb-site-set__field">
            <span>Access key</span>
            <input v-model="accessKeyId" :placeholder="saved?.hasKeys ? 'Saved' : ''" autocomplete="off" spellcheck="false">
          </label>
          <label class="mb-site-set__field">
            <span>Secret</span>
            <input v-model="secretAccessKey" type="password" :placeholder="saved?.hasKeys ? 'Saved' : ''" autocomplete="new-password">
          </label>
        </div>
      </div>
      <div class="mb-set-row mb-site-set__form">
        <label class="mb-site-set__field">
          <span>Its address on the web</span>
          <input v-model="baseUrl" placeholder="https://example.com/pages/" autocomplete="url" spellcheck="false">
        </label>
        <span class="mb-site-set__note">Where the web server serves that place. A page goes at this address followed by its name.</span>
      </div>
    </fieldset>
    <p v-if="problem" class="mb-site-set__problem" role="alert">{{ problem }}</p>
    <p v-if="!canManage" class="mb-site-set__note mb-site-set__note--alone">The home's owners and admins set this up.</p>
    <div v-else class="mb-site-set__actions">
      <button v-if="saved" type="button" class="mb-set-pill" :disabled="saving" @click="removing = true">Remove website</button>
      <span v-else class="mb-site-set__note">Publishing a page puts it on the internet, for anyone.</span>
      <button type="button" class="mb-set-pill mb-set-pill--dark" :disabled="saving" @click="save">
        {{ saving ? "Checking…" : "Save" }}
      </button>
    </div>
    <MercbotConfirmDialog
      v-model="removing"
      title="Remove this website?"
      text="Mercbot forgets where it publishes pages. Unpublish every page from it first."
      confirm-label="Remove"
      @confirm="remove"
    />
  </section>
</template>

<style scoped>
.mb-site-set__card {
  min-width: 0;
  margin-top: 0;
  margin-inline: 0;
  padding: 0;
}

.mb-site-set__card:disabled {
  opacity: 0.7;
}

.mb-site-set__choice {
  gap: 12px;
  cursor: pointer;
}

.mb-site-set__choice input {
  flex: none;
  accent-color: rgb(var(--v-theme-link));
}

.mb-site-set__form {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding-top: 12px;
  padding-bottom: 12px;
}

.mb-site-set__pair {
  display: flex;
  gap: 10px;
}

.mb-site-set__field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 13px;
}

.mb-site-set__field input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface));
}

.mb-site-set__problem {
  margin: 10px 0 0;
  font-size: 13px;
  color: rgb(var(--v-theme-error));
}

.mb-site-set__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}

.mb-site-set__note {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-site-set__note--alone {
  display: block;
  margin: 12px 0 0;
}
</style>
