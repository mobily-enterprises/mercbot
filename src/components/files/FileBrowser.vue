<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import { useRoute } from "vue-router";
import { useDisplay } from "vuetify";
import { useShellWebErrorRuntime } from "@jskit-ai/shell-web/client/error";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import MercbotAvatar from "@/components/mercbot/MercbotAvatar.vue";
import MercbotConfirmDialog from "@/components/mercbot/MercbotConfirmDialog.vue";
import MercbotFileViewer from "@/components/mercbot/MercbotFileViewer.vue";
import { fileKind, fileUrl, filesApi, formatSize, storageApi, uploadFile } from "@/components/mercbot/filesApi.js";
import MercbotPlacePicker from "./MercbotPlacePicker.vue";
import { ARCHIVED_NOTE, LOCKED_NOTE, dropLabel, dropMode, nameOf, onMac, parentOf, pickerLabel, startKey, useFilePlaces, useFolderListing } from "./filePlaces.js";
import { useFileTransfer } from "./useFileTransfer.js";

// The one file browser (D-47, D-112 R6): on the left every place the person can open (the chat it was opened from,
// Home files, each bot's files, the rooms and chats), on the right one folder of the place chosen, with open,
// download, upload, new folder, rename, Copy to…, Move to… and delete. Rows drag onto a place: a move, or a copy with
// Ctrl (⌥ on a Mac) held. Where it's narrow (a phone), the places are a picker at the top. It opens at the bot's files on
// a bot's card, at the chat's in a chat's details, and at Home files on the Files page.
const props = defineProps({
  // The chat it's opened from (its row), whose folder it lists first, or null.
  chat: { type: Object, default: null },
  // The bot whose card it's on: it opens at that bot's files, and the chat's folder is reached through it.
  botId: { type: String, default: null },
  refreshKey: { type: [String, Number], default: 0 }
});

const errorRuntime = useShellWebErrorRuntime();
const report = (error, fallback) => {
  errorRuntime.report({ source: "mercbot.files", message: error?.message || fallback, cause: error, intent: "action-feedback", severity: "error" });
};
const { places, problem: placesProblem, load: loadPlaces } = useFilePlaces({
  chat: () => props.chat,
  chatBotId: () => props.botId ?? (props.chat?.bots?.[0]?.botId == null ? null : String(props.chat.bots[0].botId))
});
const { at, current, failure, crumbs, go, reload } = useFolderListing();
const { question, asking, busy: moving, confirm, transfer } = useFileTransfer({ report });

const place = computed(() => at.value?.item || null);
const groups = computed(() => [
  { title: "", items: (places.value || []).filter((item) => item.group === "here" || item.group === "home") },
  { title: "Bots", items: (places.value || []).filter((item) => item.group === "bots") },
  { title: "Rooms and chats", items: (places.value || []).filter((item) => item.group === "chats") }
].filter((group) => group.items.length));

// A home whose files are in Google Drive that needs signing in again (D-80): "can" for whoever can sign it in again
// (Sign in again opens Connect apps on Google Drive, in the shell), "ask" for everyone else.
const signIn = ref("");
const route = useRoute();
const paths = usePaths();
const signInLink = computed(() => ({ path: paths.page("/"), query: { ...route.query, connect: "google-drive" } }));
watch(failure, (error) => {
  signIn.value = "";
  if (error?.code !== "files_storage_sign_in_again") return;
  storageApi.get().then((storage) => {
    signIn.value = storage.canSignIn ? "can" : "ask";
  }, () => {});
});

// Narrow (a phone, or a narrow details panel): the places are a picker at the top.
const display = useDisplay();
const root = ref(null);
const width = ref(null);
const narrow = computed(() => (width.value === null ? display.xs.value : width.value < 600));
let observer = null;

function openPlace(key) {
  const item = (places.value || []).find((entry) => entry.key === key);
  if (item) go(item);
}

async function openStart() {
  await loadPlaces();
  const start = startKey({ botId: props.botId, chat: props.chat });
  openPlace((places.value || []).some((item) => item.key === start) ? start : "home");
}

// The places are read as it starts, then it opens at its start place.
openStart();
onMounted(() => {
  if (typeof ResizeObserver !== "function" || !root.value) return;
  observer = new ResizeObserver(([entry]) => { width.value = entry.contentRect.width; });
  observer.observe(root.value);
});
onBeforeUnmount(() => {
  if (observer) observer.disconnect();
});
watch(() => props.refreshKey, reload);

const busy = ref(false);
const viewing = ref(null);
const deleting = ref(null);
const deleteOpen = ref(false);
const dialog = reactive({ open: false, mode: "", entry: null, name: "", error: "" });
const picker = reactive({ open: false, mode: "copy", from: null, path: "" });
const uploadInput = ref(null);
const entries = computed(() => current.value?.entries || []);
const when = (iso) => {
  const date = new Date(iso);
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString([], { day: "numeric", month: "short", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
};

async function act(work, failureText) {
  busy.value = true;
  try {
    await work();
    await reload();
    return true;
  } catch (error) {
    report(error, failureText);
    return false;
  } finally {
    busy.value = false;
  }
}

function open(entry) {
  if (entry.folder) go(place.value, entry.path);
  else viewing.value = { path: entry.path, name: nameOf(entry.path) };
}

async function uploadChosen(event) {
  const chosen = [...(event.target.files || [])];
  event.target.value = "";
  const item = place.value;
  const folder = at.value?.folder;
  if (!chosen.length || !item) return;
  await act(async () => {
    for (const file of chosen) await uploadFile(item.botId, file, folder, item.chat);
  }, "That file didn't upload.");
}

function startDialog(mode, entry = null) {
  Object.assign(dialog, { open: true, mode, entry, error: "", name: entry ? nameOf(entry.path) : "" });
}
async function saveDialog() {
  const name = dialog.name.trim();
  if (!name || name.includes("/")) {
    dialog.error = "Give it a name without slashes.";
    return;
  }
  const item = place.value;
  const done = dialog.mode === "folder"
    ? await act(() => filesApi.makeFolder(item.botId, `${at.value.folder}/${name}`, item.chat), "The folder couldn't be made.")
    : await act(() => filesApi.move(item.botId, dialog.entry.path, `${parentOf(dialog.entry.path)}/${name}`, item.chat), "That couldn't be renamed.");
  if (done) dialog.open = false;
}

function askDelete(entry) {
  deleting.value = entry;
  deleteOpen.value = true;
}
async function confirmDelete() {
  const item = place.value;
  await act(() => filesApi.remove(item.botId, deleting.value.path, item.chat), "That couldn't be deleted.");
}

// Copy to… and Move to…: the place picker, then the transfer (with the question first when it widens who sees it).
function startPicker(mode, entry) {
  Object.assign(picker, { open: true, mode, from: place.value, path: entry.path });
}
async function send(request) {
  if (await transfer(request)) await reload();
}
const picked = ({ to, folder }) => send({ mode: picker.mode, from: picker.from, path: picker.path, to, folder });

function menuFor(entry) {
  const item = place.value;
  const reading = [
    { title: "Open", action: () => open(entry) },
    ...(entry.folder ? [] : [{ title: "Download", href: fileUrl(item.botId, entry.path, { chat: item.chat }) }])
  ];
  // Database files are opened and copied out, never changed by hand (D-130).
  if (item.locked) return [...reading, { title: "Copy to…", action: () => startPicker("copy", entry) }];
  return [
    ...reading,
    { title: "Rename", action: () => startDialog("rename", entry) },
    { title: "Copy to…", action: () => startPicker("copy", entry) },
    { title: "Move to…", action: () => startPicker("move", entry) },
    { title: "Delete", action: () => askDelete(entry) }
  ];
}

// Dragging a row onto a place: what it'll do shows on the place, and the drop runs the same transfer as the menu.
const mac = onMac();
const dragging = ref(null);
const over = ref(null);
function startDrag(event, entry) {
  dragging.value = { from: place.value, path: entry.path };
  event.dataTransfer.effectAllowed = "copyMove";
  event.dataTransfer.setData("text/plain", nameOf(entry.path));
}
// A file dragged out of Database files is copied, never moved; nothing is dropped into them.
const dragMode = (event) => (dragging.value?.from?.locked ? "copy" : dropMode(event, mac));
function dragOver(event, item) {
  if (!dragging.value || item.archived || item.locked) return;
  event.preventDefault();
  const mode = dragMode(event);
  event.dataTransfer.dropEffect = mode;
  over.value = { key: item.key, mode };
}
function dragLeave(item) {
  if (over.value?.key === item.key) over.value = null;
}
function drop(event, item) {
  const dragged = dragging.value;
  dragging.value = null;
  over.value = null;
  if (!dragged || item.archived || item.locked) return;
  event.preventDefault();
  send({ mode: dragged.from?.locked ? "copy" : dropMode(event, mac), from: dragged.from, path: dragged.path, to: item, folder: item.root });
}
function endDrag() {
  dragging.value = null;
  over.value = null;
}
</script>

<template>
  <div ref="root" class="mb-files" :class="{ 'mb-files--narrow': narrow }">
    <p v-if="placesProblem" class="mb-files__problem" role="alert">
      <v-icon icon="$error" size="16" /> {{ placesProblem }}
      <v-btn size="small" variant="text" @click="openStart">Try again</v-btn>
    </p>
    <div v-else-if="!places" class="mb-files__skeleton" aria-hidden="true" />
    <template v-else>
      <!-- readable-check: allow selection-field - data: the places this browser already read, by key -->
      <v-select
        v-if="narrow"
        :model-value="place?.key"
        :items="places"
        :item-title="pickerLabel"
        item-value="key"
        label="Place"
        variant="outlined"
        density="comfortable"
        hide-details
        class="mb-files__place-picker"
        @update:model-value="openPlace"
      />
      <nav v-else class="mb-files__places" aria-label="Places">
        <div v-for="group in groups" :key="group.title" class="mb-files__group">
          <p v-if="group.title" class="mb-files__group-title">{{ group.title }}</p>
          <button
            v-for="item in group.items"
            :key="item.key"
            type="button"
            class="mb-files__place"
            :class="{ 'mb-files__place--here': item.key === place?.key, 'mb-files__place--over': over?.key === item.key }"
            :aria-current="item.key === place?.key ? 'true' : undefined"
            :title="item.archived ? `${item.label} (archived)` : item.label"
            @click="go(item)"
            @dragover="dragOver($event, item)"
            @dragleave="dragLeave(item)"
            @drop="drop($event, item)"
          >
            <MercbotAvatar v-if="item.bot" :bot="item.bot" :size="20" still />
            <v-icon v-else :icon="item.icon" size="18" class="mb-files__icon" />
            <span class="mb-files__place-name">{{ over?.key === item.key ? dropLabel(over.mode, item) : item.label }}</span>
          </button>
        </div>
      </nav>

      <section v-if="place" class="mb-files__section" :aria-label="pickerLabel(place)">
        <div class="mb-files__head">
          <nav class="mb-files__crumbs" :aria-label="`${pickerLabel(place)} folders`">
            <template v-for="(crumb, index) in crumbs" :key="crumb.path">
              <v-icon v-if="index" icon="$chevronRight" size="14" class="mb-files__crumb-sep" />
              <button type="button" class="mb-files__crumb" :class="{ 'mb-files__crumb--here': crumb.path === at.folder }" @click="go(place, crumb.path)">{{ crumb.label }}</button>
            </template>
          </nav>
          <v-btn v-if="!place.locked" icon="$createNewFolder" size="x-small" variant="text" :disabled="place.archived" :loading="busy" :aria-label="`New folder in ${pickerLabel(place)}`" @click="startDialog('folder')" />
          <v-btn v-if="!place.locked" icon="$uploadArrow" size="x-small" variant="text" :disabled="place.archived" :loading="busy" :aria-label="`Upload to ${pickerLabel(place)}`" @click="uploadInput.click()" />
        </div>
        <p v-if="place.archived" class="mb-files__empty">{{ ARCHIVED_NOTE }}</p>
        <p v-if="place.locked" class="mb-files__empty" data-testid="files-locked-note">{{ LOCKED_NOTE }}</p>
        <p v-if="failure" class="mb-files__problem" role="alert">
          {{ failure.message || "The files couldn't load." }}
          <router-link v-if="signIn === 'can'" :to="signInLink" class="mb-files__sign-in">Sign in again</router-link>
          <template v-else-if="signIn === 'ask'">Ask whoever connected it to sign in again in Connect apps.</template>
          <v-btn v-else size="small" variant="text" @click="reload">Try again</v-btn>
        </p>
        <div v-else-if="!current" class="mb-files__skeleton" aria-hidden="true" />
        <p v-else-if="!entries.length" class="mb-files__empty">{{ at.folder === place.root ? "Nothing here yet." : "This folder is empty." }}</p>
        <ul v-else class="mb-files__list">
          <li v-for="entry in entries" :key="entry.path" class="mb-files__row" :draggable="!narrow" @dragstart="startDrag($event, entry)" @dragend="endDrag">
            <button type="button" class="mb-files__open" @click="open(entry)">
              <v-icon :icon="entry.folder ? '$folder' : fileKind(entry.path).icon" size="18" class="mb-files__icon" />
              <span class="mb-files__name">{{ nameOf(entry.path) }}</span>
              <span v-if="!entry.folder" class="mb-files__meta">{{ formatSize(entry.size) }} · {{ when(entry.modified) }}</span>
            </button>
            <v-menu location="bottom end">
              <template #activator="{ props: menu }">
                <v-btn v-bind="menu" icon="$moreVert" size="x-small" variant="text" :loading="moving" :aria-label="`More for ${nameOf(entry.path)}`" />
              </template>
              <v-list density="compact" role="menu">
                <!-- readable-check: allow optional-call - optional operation: Download has only an href, which the link follows -->
                <v-list-item v-for="item in menuFor(entry)" :key="item.title" role="menuitem" :title="item.title" :href="item.href" :download="item.href ? nameOf(entry.path) : undefined" @click="item.action?.()" />
              </v-list>
            </v-menu>
          </li>
        </ul>
        <p v-if="current?.partial" class="mb-files__empty">This folder has more than 5,000 files; the newest 300 of the first 5,000 found are shown.</p>
        <p v-else-if="current?.left" class="mb-files__empty">The newest 300 are shown; {{ current.left }} older ones aren't.</p>
      </section>
    </template>
    <input ref="uploadInput" type="file" multiple hidden @change="uploadChosen">

    <v-dialog v-model="dialog.open" max-width="420">
      <v-card :title="dialog.mode === 'folder' ? 'New folder' : 'Rename'">
        <v-card-text>
          <v-text-field v-model="dialog.name" label="Name" variant="outlined" density="comfortable" autofocus :error-messages="dialog.error" @keydown.enter="saveDialog" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="dialog.open = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" :loading="busy" @click="saveDialog">{{ dialog.mode === "folder" ? "Make" : "Rename" }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
    <MercbotPlacePicker v-model="picker.open" :mode="picker.mode" :places="places" :start="picker.from?.key || ''" :from="picker.from?.key || ''" :path="picker.path" @choose="picked" />
    <MercbotConfirmDialog v-model="asking" title="Let more people see it?" :text="question" confirm-label="Continue" :danger="false" @confirm="confirm" />
    <MercbotConfirmDialog
      v-model="deleteOpen"
      :title="`Delete ${deleting ? nameOf(deleting.path) : ''}?`"
      :text="deleting?.folder ? 'Only an empty folder can be deleted.' : 'It\'s gone for good, for everyone who can see this folder.'"
      @confirm="confirmDelete"
    />
    <Teleport to="body">
      <MercbotFileViewer v-if="viewing && place" :bot-id="place.botId" :chat-id="place.chat" :file="viewing" @close="viewing = null" />
    </Teleport>
  </div>
</template>

<style scoped src="./FileBrowser.css"></style>
