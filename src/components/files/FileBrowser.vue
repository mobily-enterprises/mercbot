<script setup>
import { computed, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import MercbotConfirmDialog from "@/components/mercbot/MercbotConfirmDialog.vue";
import MercbotFileViewer from "@/components/mercbot/MercbotFileViewer.vue";
import { fileKind, fileUrl, filesApi, formatSize, storageApi, uploadFile } from "@/components/mercbot/filesApi.js";

// A file browser over some of a bot's folders, or the home's own (D-47): each folder with its
// sub-folders, and open, download, upload, new folder, move to another folder, rename and delete.
// `sections` are { key, label, root }, where key is the listing's (mine, bot, shared).
const props = defineProps({
  botId: { type: String, default: null },
  sections: { type: Array, required: true },
  refreshKey: { type: [String, Number], default: 0 }
});

// Each section's folder shown, as the server lists it: { path, entries, left, partial }.
const listings = reactive({});
// Every folder of each section, read when Move to… opens.
const tree = ref(null);
const problem = ref("");
// A home whose files are in Google Drive that needs signing in again (D-80): "can" for whoever can sign it in again
// (Sign in again opens Connect apps on Google Drive, in the shell), "ask" for everyone else.
const signIn = ref("");
const route = useRoute();
const paths = usePaths();
const signInLink = computed(() => ({ path: paths.page("/"), query: { ...route.query, connect: "google-drive" } }));
const at = reactive({});
const busy = ref(false);
const viewing = ref(null);
const deleting = ref(null);
const deleteOpen = ref(false);
const dialog = reactive({ open: false, mode: "", entry: null, name: "", folder: "", error: "" });
const uploadInput = ref(null);
let uploadSection = null;

const nameOf = (filePath) => filePath.split("/").pop();
const parentOf = (filePath) => filePath.slice(0, filePath.lastIndexOf("/"));
const when = (iso) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

for (const section of props.sections) at[section.key] = section.root;

// One section's current folder; a reply for a folder left meanwhile is dropped.
async function loadSection(section) {
  const folder = at[section.key];
  const listed = await filesApi.list(props.botId, folder);
  if (at[section.key] === folder) listings[section.key] = listed;
}

function failed(error, fallback) {
  problem.value = error?.message || fallback;
  signIn.value = "";
  if (error?.code !== "files_storage_sign_in_again") return;
  storageApi.get().then((storage) => {
    signIn.value = storage.canSignIn ? "can" : "ask";
  }, () => {});
}

async function load() {
  problem.value = "";
  signIn.value = "";
  try {
    await Promise.all(props.sections.map(loadSection));
  } catch (error) {
    failed(error, "The files couldn't load.");
  }
}
onMounted(load);
watch(() => [props.botId, props.refreshKey], load);

function go(section, folder) {
  at[section.key] = folder;
  problem.value = "";
  loadSection(section).catch((error) => failed(error, "The files couldn't load."));
}

const shown = computed(() => props.sections.filter((section) => listings[section.key]));

// The listing of a section's current folder, once it has come.
const current = (section) => (listings[section.key]?.path === at[section.key] ? listings[section.key] : null);

// What's directly in a section's current folder: folders first, then files, newest first.
const entriesOf = (section) => current(section)?.entries || [];

function crumbs(section) {
  const here = at[section.key];
  const parts = here.slice(section.root.length).split("/").filter(Boolean);
  return [{ label: section.label, path: section.root }, ...parts.map((part, index) => ({ label: part, path: `${section.root}/${parts.slice(0, index + 1).join("/")}` }))];
}

// Every folder a file can go to, across the sections shown.
const destinations = computed(() => shown.value.flatMap((section) => [
  { title: section.label, value: section.root },
  ...(tree.value?.[section.key] || []).map((folder) => ({ title: `${section.label} / ${folder.slice(section.root.length + 1)}`, value: folder }))
]));

async function act(work, failure) {
  busy.value = true;
  try {
    await work();
    await load();
    return true;
  } catch (error) {
    failed(error, failure);
    return false;
  } finally {
    busy.value = false;
  }
}

function open(section, entry) {
  if (entry.folder) go(section, entry.path);
  else viewing.value = { path: entry.path, name: nameOf(entry.path) };
}

function startUpload(section) {
  uploadSection = section;
  uploadInput.value?.click();
}
async function uploadChosen(event) {
  const chosen = [...(event.target.files || [])];
  event.target.value = "";
  if (!chosen.length || !uploadSection) return;
  const folder = at[uploadSection.key];
  await act(async () => {
    for (const file of chosen) await uploadFile(props.botId, file, folder);
  }, "That file didn't upload.");
}

function startDialog(mode, section, entry = null) {
  Object.assign(dialog, { open: true, mode, entry, error: "", name: entry ? nameOf(entry.path) : "", folder: entry ? parentOf(entry.path) : at[section.key], section });
  if (mode !== "move") return;
  tree.value = null;
  filesApi.folders(props.botId).then((found) => {
    tree.value = found;
  }, (error) => failed(error, "The folders couldn't load."));
}
async function saveDialog() {
  const name = dialog.name.trim();
  if (dialog.mode !== "move" && (!name || name.includes("/"))) {
    dialog.error = "Give it a name without slashes.";
    return;
  }
  const target = dialog.mode === "move" ? `${dialog.folder}/${nameOf(dialog.entry.path)}` : `${dialog.folder}/${name}`;
  const done = await act(
    () => (dialog.mode === "folder" ? filesApi.makeFolder(props.botId, target) : filesApi.move(props.botId, dialog.entry.path, target)),
    dialog.mode === "folder" ? "The folder couldn't be made." : "That couldn't be moved."
  );
  if (done) dialog.open = false;
}

function askDelete(entry) {
  deleting.value = entry;
  deleteOpen.value = true;
}
async function confirmDelete() {
  deleteOpen.value = false;
  await act(() => filesApi.remove(props.botId, deleting.value.path), "That couldn't be deleted.");
}

function menuFor(section, entry) {
  return [
    ...(entry.folder ? [] : [{ title: "Open", action: () => open(section, entry) }, { title: "Download", href: fileUrl(props.botId, entry.path) }]),
    { title: "Move to…", action: () => startDialog("move", section, entry) },
    { title: "Rename", action: () => startDialog("rename", section, entry) },
    { title: "Delete", action: () => askDelete(entry) }
  ];
}
</script>

<template>
  <div class="mb-files">
    <p v-if="problem" class="mb-files__problem" role="alert">
      {{ problem }}
      <router-link v-if="signIn === 'can'" :to="signInLink" class="mb-files__sign-in">Sign in again</router-link>
      <template v-else-if="signIn === 'ask'">Ask whoever connected it to sign in again in Connect apps.</template>
    </p>
    <div v-if="!shown.length && !problem" class="mb-files__skeleton" aria-hidden="true" />
    <section v-for="section in shown" :key="section.key" class="mb-files__section">
      <div class="mb-files__head">
        <nav class="mb-files__crumbs" :aria-label="`${section.label} folders`">
          <template v-for="(crumb, index) in crumbs(section)" :key="crumb.path">
            <v-icon v-if="index" icon="$chevronRight" size="14" class="mb-files__crumb-sep" />
            <button type="button" class="mb-files__crumb" :class="{ 'mb-files__crumb--here': crumb.path === at[section.key] }" @click="go(section, crumb.path)">{{ crumb.label }}</button>
          </template>
        </nav>
        <v-btn icon="$createNewFolder" size="x-small" variant="text" :disabled="busy" :aria-label="`New folder in ${section.label}`" @click="startDialog('folder', section)" />
        <v-btn icon="$uploadArrow" size="x-small" variant="text" :disabled="busy" :aria-label="`Upload to ${section.label}`" @click="startUpload(section)" />
      </div>
      <div v-if="!current(section)" class="mb-files__skeleton" aria-hidden="true" />
      <p v-else-if="!entriesOf(section).length" class="mb-files__empty">{{ at[section.key] === section.root ? "Nothing here yet." : "This folder is empty." }}</p>
      <ul v-else class="mb-files__list">
        <li v-for="entry in entriesOf(section)" :key="entry.path" class="mb-files__row">
          <button type="button" class="mb-files__open" @click="open(section, entry)">
            <v-icon :icon="entry.folder ? '$folder' : fileKind(entry.path).icon" size="18" class="mb-files__icon" />
            <span class="mb-files__name">{{ nameOf(entry.path) }}</span>
            <span v-if="!entry.folder" class="mb-files__meta">{{ formatSize(entry.size) }} · {{ when(entry.modified) }}</span>
          </button>
          <v-menu location="bottom end">
            <template #activator="{ props: menu }">
              <v-btn v-bind="menu" icon="$moreVert" size="x-small" variant="text" :aria-label="`More for ${nameOf(entry.path)}`" />
            </template>
            <v-list density="compact">
              <!-- readable-check: allow optional-call - optional operation: Download has only an href, which the link follows -->
              <v-list-item v-for="item in menuFor(section, entry)" :key="item.title" :title="item.title" :href="item.href" :download="item.href ? nameOf(entry.path) : undefined" @click="item.action?.()" />
            </v-list>
          </v-menu>
        </li>
      </ul>
      <p v-if="current(section)?.partial" class="mb-files__empty">This folder has more than 5,000 files; the newest 300 of the first 5,000 found are shown.</p>
      <p v-else-if="current(section)?.left" class="mb-files__empty">The newest 300 are shown; {{ current(section).left }} older ones aren't.</p>
    </section>
    <input ref="uploadInput" type="file" multiple hidden @change="uploadChosen">

    <v-dialog v-model="dialog.open" max-width="420">
      <v-card :title="dialog.mode === 'folder' ? 'New folder' : dialog.mode === 'rename' ? 'Rename' : `Move ${nameOf(dialog.entry?.path || '')}`">
        <v-card-text>
          <!-- readable-check: allow selection-field - data: the folders of the tree this browser already shows -->
          <v-select v-if="dialog.mode === 'move'" v-model="dialog.folder" :items="destinations" label="Folder" variant="outlined" density="comfortable" hide-details />
          <v-text-field v-else v-model="dialog.name" label="Name" variant="outlined" density="comfortable" autofocus :error-messages="dialog.error" @keydown.enter="saveDialog" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.open = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :disabled="busy" @click="saveDialog">{{ dialog.mode === "folder" ? "Make" : dialog.mode === "rename" ? "Rename" : "Move" }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <MercbotConfirmDialog
      v-model="deleteOpen"
      :title="`Delete ${deleting ? nameOf(deleting.path) : ''}?`"
      :text="deleting?.folder ? 'Only an empty folder can be deleted.' : 'It\'s gone for good, for everyone who can see this folder.'"
      @confirm="confirmDelete"
    />
    <Teleport to="body">
      <MercbotFileViewer v-if="viewing" :bot-id="botId" :file="viewing" @close="viewing = null" />
    </Teleport>
  </div>
</template>

<style scoped>
.mb-files {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.mb-files__section {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.mb-files__head {
  display: flex;
  align-items: center;
  gap: 2px;
}

.mb-files__crumbs {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: center;
  min-width: 0;
}

.mb-files__crumb {
  padding: 2px 4px;
  border: 0;
  border-radius: 6px;
  background: none;
  color: rgb(var(--v-theme-on-surface-variant));
  font: inherit;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.mb-files__crumb--here {
  color: rgb(var(--v-theme-on-surface));
}

.mb-files__crumb:hover,
.mb-files__crumb:focus-visible {
  background: rgba(var(--v-theme-on-surface), 0.06);
}

.mb-files__crumb-sep {
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-files__list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.mb-files__row {
  display: flex;
  align-items: center;
  border-radius: 8px;
}

.mb-files__row:hover {
  background: rgba(var(--v-theme-on-surface), 0.04);
}

.mb-files__open {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.mb-files__icon {
  flex-shrink: 0;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-files__name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mb-files__meta {
  flex-shrink: 0;
  font-size: 12px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-files__empty,
.mb-files__problem {
  margin: 0;
  padding: 4px 8px;
  font-size: 13px;
  color: rgb(var(--v-theme-on-surface-variant));
}

.mb-files__problem {
  color: rgb(var(--v-theme-error));
}

.mb-files__sign-in {
  margin-left: 8px;
  font-weight: 600;
  color: rgb(var(--v-theme-link));
}

.mb-files__skeleton {
  height: 96px;
  border-radius: 8px;
  background: rgba(var(--v-theme-on-surface), 0.05);
}
</style>
