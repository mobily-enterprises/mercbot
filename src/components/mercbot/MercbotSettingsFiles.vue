<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { storageApi } from "./filesApi.js";
import { useHomes } from "./homesApi.js";
import MercbotSettingsSelect from "./MercbotSettingsSelect.vue";
import { driveNotices, keptIn, moveGoing, moveProgress, spaceLine } from "./storageNotices.js";

// Settings → Files (D-26, D-36, D-80): where the home keeps its bots' files. Mercbot's own storage,
// a Google Drive account connected in Connect apps (Mercbot makes one folder there and keeps the
// files in it), or the home's own WebDAV storage such as Nextcloud, which Mercbot checks before
// saving. Choosing another place moves all the home's files there first, with its progress here,
// which owners and admins can cancel; files that can't be read where they are can be left there.
// Owners and admins choose; members see the choice. A Drive that needs signing in again says so,
// with Sign in again for whoever can. Opening it has Mercbot look at the Drive: its space, and
// Mercbot's folder put in the bin or deleted, with Choose again (a new folder in the same Drive).
const emit = defineEmits(["failure", "notify", "connect"]);
const current = ref(null);
const kind = ref("mercbot");
const url = ref("");
const user = ref("");
const password = ref("");
const vendor = ref("other");
const driveAccount = ref("");
const saving = ref(false);
const problem = ref("");
// The choice whose files can't be read where they are now, offered to save without them.
const withoutFiles = ref(null);
const { manages: manager, load } = useHomes();

// While the home's files move, this rereads where they are every 2 seconds, until the move ends, and says how it ended.
const move = computed(() => current.value?.move || null);
const moving = computed(() => moveGoing(current.value));
let following = null;
function follow() {
  clearTimeout(following);
  if (!moving.value) return;
  following = setTimeout(async () => {
    try {
      show(await storageApi.get());
      // Once it ended in a Google Drive, Mercbot looks at its folder and space there, as when this page opens.
      if (!moving.value && current.value?.kind === "drive") show(await storageApi.get({ fresh: true }));
    } catch {
      // Tried again on the next round.
    }
    const ended = moving.value ? null : move.value;
    if (ended?.status === "done") emit("notify", `This home's files are now kept ${keptIn(ended.to)}`);
    if (ended?.status === "cancelled") emit("notify", `Move cancelled. This home's files are still kept ${keptIn(ended.from)}`);
    follow();
  }, 2000);
}
onBeforeUnmount(() => clearTimeout(following));

const savedDrive = computed(() => (current.value?.kind === "drive" ? current.value : null));
const notices = computed(() => driveNotices(savedDrive.value, "settings"));
// The person's own Google Drive accounts and the home's; the saved one too when it's someone else's.
const driveOptions = computed(() => {
  const options = (current.value?.driveAccounts || []).map((account) => ({ value: account.id, label: account.label, hint: account.home ? "The home's" : "" }));
  const saved = savedDrive.value;
  if (saved && !options.some((option) => option.value === saved.accountId)) options.unshift({ value: saved.accountId, label: saved.account, hint: "In use" });
  return options;
});

function show(storage) {
  const wasMoving = moving.value;
  current.value = storage;
  if (!wasMoving && moving.value) follow();
  kind.value = storage.kind;
  url.value = storage.url || "";
  user.value = storage.user || "";
  vendor.value = storage.vendor || "other";
  password.value = "";
  driveAccount.value = storage.accountId || storage.driveAccounts?.[0]?.id || "";
}

const CHOSEN = {
  mercbot: "This home's files are now kept on Mercbot",
  drive: "This home's files are now kept in Google Drive",
  webdav: "This home's files are now kept in its own storage"
};

function choice() {
  if (kind.value === "mercbot") return { kind: "mercbot" };
  if (kind.value === "drive") return { kind: "drive", accountId: driveAccount.value };
  return { kind: "webdav", url: url.value, user: user.value, password: password.value, vendor: vendor.value };
}

onMounted(async () => {
  try {
    const [storage] = await Promise.all([storageApi.get({ fresh: true }), load()]);
    show(storage);
  } catch (error) {
    emit("failure", error);
  }
});

// The same Google Drive again: Mercbot makes a new folder there, as the one it had is in the bin (the files move to
// the new folder) or deleted (nothing to move).
function chooseAgain() {
  kind.value = "drive";
  driveAccount.value = savedDrive.value.accountId;
  return save(savedDrive.value.folderState === "missing" ? { ...choice(), withoutFiles: true } : choice());
}

async function save(chosen = choice()) {
  saving.value = true;
  problem.value = "";
  withoutFiles.value = null;
  try {
    show(await storageApi.choose(chosen));
    emit("notify", moving.value ? `Moving this home's files to ${move.value.to.label}` : CHOSEN[chosen.kind]);
  } catch (error) {
    problem.value = error?.message || "That didn't work. Try again.";
    if (error?.code === "files_storage_source_unreadable") withoutFiles.value = { ...chosen, withoutFiles: true };
  } finally {
    saving.value = false;
  }
}

async function cancelMove() {
  try {
    show(await storageApi.cancelMove());
  } catch (error) {
    emit("failure", error);
  }
}
</script>

<template>
  <section v-if="current">
    <p class="mb-set-group">Where this home keeps its files</p>
    <div v-if="moving" class="mb-files-set__move" role="status">
      <span class="mb-set-row__text">
        <span class="mb-set-row__label">Moving this home's files from {{ move.from.label }} to {{ move.to.label }}</span>
        <span class="mb-set-row__description">{{ moveProgress(move) }} Until it's done they're read-only, and the bots say so.</span>
      </span>
      <button v-if="manager && move.status === 'running'" type="button" class="mb-set-pill" @click="cancelMove">
        {{ move.cancelling ? "Cancelling…" : "Cancel" }}
      </button>
    </div>
    <div v-else-if="move?.status === 'failed'" class="mb-files-set__drive-notice" role="alert">
      <span>The move to {{ move.to.label }} stopped: {{ move.error }} This home's files are still kept {{ keptIn(move.from) }}, as they were.</span>
    </div>
    <fieldset class="mb-set-card mb-files-set__card" :disabled="!manager || moving">
      <label class="mb-set-row mb-files-set__choice">
        <input v-model="kind" type="radio" value="mercbot">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">On Mercbot</span>
          <span class="mb-set-row__description">Mercbot keeps the bots' files for you.</span>
        </span>
      </label>
      <label class="mb-set-row mb-files-set__choice">
        <input v-model="kind" type="radio" value="drive">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">In Google Drive</span>
          <span class="mb-set-row__description">A Google Drive account connected in Connect apps. Mercbot makes one folder there and keeps the bots' files in it.</span>
        </span>
      </label>
      <div v-if="kind === 'drive'" class="mb-set-row mb-files-set__form">
        <template v-if="driveOptions.length">
          <div class="mb-files-set__drive">
            <span>Account</span>
            <MercbotSettingsSelect v-model="driveAccount" :options="driveOptions" label="Google Drive account" :width="280" />
          </div>
          <p v-if="savedDrive" class="mb-files-set__note">In the folder “{{ savedDrive.folder }}” of {{ savedDrive.account }}'s Google Drive. {{ spaceLine(savedDrive.space) }}</p>
        </template>
        <p v-else class="mb-files-set__note">
          No Google Drive account is connected yet.
          <button type="button" class="mb-files-set__link" @click="emit('connect', 'google-drive')">Connect Google Drive</button>
        </p>
      </div>
      <label class="mb-set-row mb-files-set__choice">
        <input v-model="kind" type="radio" value="webdav">
        <span class="mb-set-row__text">
          <span class="mb-set-row__label">In the home's own storage</span>
          <span class="mb-set-row__description">Nextcloud or any storage with a WebDAV address. The bots' files live there, in a Mercbot folder.</span>
        </span>
      </label>
      <div v-if="kind === 'webdav'" class="mb-set-row mb-files-set__form">
        <label class="mb-files-set__field">
          <span>Address</span>
          <input v-model="url" placeholder="https://cloud.example.com/remote.php/dav/files/you/" autocomplete="url">
        </label>
        <div class="mb-files-set__pair">
          <label class="mb-files-set__field">
            <span>Username</span>
            <input v-model="user" autocomplete="username">
          </label>
          <label class="mb-files-set__field">
            <span>Password</span>
            <input v-model="password" type="password" autocomplete="new-password" :placeholder="current.kind === 'webdav' ? 'Saved' : ''">
          </label>
        </div>
        <label class="mb-files-set__check">
          <input v-model="vendor" type="checkbox" true-value="nextcloud" false-value="other"> It's Nextcloud
        </label>
      </div>
    </fieldset>
    <div v-if="savedDrive && !savedDrive.signedIn" class="mb-files-set__signed-out" role="alert">
      <span>
        {{ savedDrive.gone
          ? "The Google Drive account this home's files were kept in was removed. Choose where to keep them."
          : `Google Drive (${savedDrive.account}) needs signing in again. The files are safe there; the bots can't use them until then.` }}
      </span>
      <button v-if="savedDrive.canSignIn" type="button" class="mb-set-pill mb-set-pill--dark" @click="emit('connect', 'google-drive')">Sign in again</button>
      <span v-else-if="!savedDrive.gone" class="mb-files-set__note">Ask whoever connected it to sign in again in Connect apps.</span>
    </div>
    <div v-for="notice in notices" :key="notice.key" class="mb-files-set__drive-notice" role="alert">
      <span>{{ notice.text }}</span>
      <button v-if="manager && notice.key !== 'space'" type="button" class="mb-set-pill mb-set-pill--dark" :disabled="saving" @click="chooseAgain">Choose again</button>
    </div>
    <div v-if="problem" class="mb-files-set__problem" role="alert">
      <span>{{ problem }}</span>
      <button v-if="withoutFiles" type="button" class="mb-set-pill" :disabled="saving" @click="save(withoutFiles)">Switch without the files</button>
    </div>
    <p v-if="!manager" class="mb-files-set__note mb-files-set__note--alone">The home's owners and admins choose this.</p>
    <div v-else class="mb-files-set__actions">
      <span class="mb-files-set__note">Saving another place moves all this home's files there, replacing what's in it.</span>
      <button type="button" class="mb-set-pill mb-set-pill--dark" :disabled="saving || moving || (kind === 'drive' && !driveAccount)" @click="save()">
        {{ saving ? "Checking…" : "Save" }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.mb-files-set__card {
  min-width: 0;
  margin-top: 0;
  margin-inline: 0;
  padding: 0;
}

.mb-files-set__card:disabled {
  opacity: 0.7;
}

.mb-files-set__note--alone {
  display: block;
  margin: 12px 0 0;
}

.mb-files-set__choice {
  gap: 12px;
  cursor: pointer;
}

.mb-files-set__choice input {
  flex: none;
  accent-color: rgb(var(--v-theme-link));
}

.mb-files-set__form {
  flex-direction: column;
  align-items: stretch;
  gap: 10px;
  padding-top: 12px;
  padding-bottom: 12px;
}

.mb-files-set__pair {
  display: flex;
  gap: 10px;
}

.mb-files-set__field {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
  font-size: 13px;
}

.mb-files-set__field input {
  height: 34px;
  padding: 0 10px;
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 8px;
  background: transparent;
  font: inherit;
  font-size: 14px;
  color: rgb(var(--v-theme-on-surface));
}

.mb-files-set__drive {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  font-size: 13px;
}

.mb-files-set__link {
  padding: 0;
  border: 0;
  background: none;
  font: inherit;
  color: rgb(var(--v-theme-link));
  text-decoration: underline;
  cursor: pointer;
}

.mb-files-set__signed-out,
.mb-files-set__drive-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 12px;
  padding: 10px 12px;
  border-radius: 10px;
  background: rgba(var(--v-theme-error), 0.08);
  font-size: 13px;
}

.mb-files-set__check {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
}

.mb-files-set__problem {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin: 10px 0 0;
  font-size: 13px;
  color: rgb(var(--v-theme-error));
}

.mb-files-set__move {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
  padding: 12px;
  border-radius: 10px;
  background: rgba(var(--v-theme-link), 0.08);
}

.mb-files-set__actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 12px;
}

.mb-files-set__note {
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
