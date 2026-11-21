import { computed, onBeforeUnmount, ref, watch } from "vue";
import { nanoMoney } from "./accountApi.js";
import { botsApi } from "./botsApi.js";
import { uploadFile } from "./filesApi.js";

// Where a file added to a bot's knowledge is kept: its folder for everyone using it, which Files shows (D-107).
export const KNOWLEDGE_FOLDER = "/files/bot/Knowledge";
// How often the list is read again while a piece is being read or got ready.
const POLL_MS = 2000;

const numbered = (count) => Number(count || 0).toLocaleString();

/**
 * A piece's line under its title, as the list shows it: being read, being got ready (its parts so far), failed (what
 * to do), or its size and whether it's always in mind or searched first. A piece in mind is in mind while its parts are
 * still being written, as the bot's turns already have it.
 * @param {{ state: string, mode: string | null, chars: number, partsDone: number, partsTotal: number, problem: string | null }} piece
 */
export function pieceLine(piece) {
  if (piece.state === "reading") return "Reading the file…";
  if (piece.state === "failed") return piece.problem || "This couldn't be read.";
  const size = `${numbered(piece.chars)} characters`;
  if (piece.mode === "mind") return `${size} · Always in mind`;
  if (piece.state === "indexing") {
    return piece.partsTotal ? `${size} · Getting it ready: ${numbered(piece.partsDone)} of ${numbered(piece.partsTotal)} parts` : `${size} · Getting it ready…`;
  }
  return `${size} · Searched first`;
}

/** Whether a piece shows a progress bar, and how far it's got (null: it can't tell yet). */
export function pieceProgress(piece) {
  if (piece.state === "reading") return { shown: true, value: null };
  if (piece.state !== "indexing" || piece.mode === "mind") return { shown: false, value: null };
  return { shown: true, value: piece.partsTotal ? Math.round((100 * piece.partsDone) / piece.partsTotal) : null };
}

// The least a message's cost is shown to, $0.0001 in nanodollars: money shows four decimal places at most, and a short
// note costs less than that.
const SMALLEST_SHOWN = 100_000;
const roughly = (nano) => (nano < SMALLEST_SHOWN ? `less than ${nanoMoney(SMALLEST_SHOWN)}` : `about ${nanoMoney(nano)}`);

/**
 * The summary under the list: how much is always in mind and searched first, and what it adds to each message (as
 * the server worked it out at the home's prices), or null for a bot that knows nothing.
 * @param {{ totals: { chars: number, inMindChars: number, searchedChars: number }, perMessage: { tokens: number, nano: number, cachedNano: number } } | null} known
 */
export function knowledgeSummary(known) {
  if (!known?.totals.chars) return null;
  const { inMindChars, searchedChars } = known.totals;
  const { nano, cachedNano } = known.perMessage;
  return {
    inMind: inMindChars ? `Always in mind: ${numbered(inMindChars)} characters, read with every message.` : "",
    searched: searchedChars ? `Searched first: ${numbered(searchedChars)} characters. Each message reads only the parts that match.` : "",
    cost: !nano
      ? ""
      : nano < SMALLEST_SHOWN
        ? `Adds less than ${nanoMoney(SMALLEST_SHOWN)} to each message.`
        : `Adds about ${nanoMoney(nano)} to each message, or ${roughly(cachedNano)} while it's still cached from a recent one.`
  };
}

/**
 * Details tab: what the bot knows (D-107). Read on the Details tab, and again every POLL_MS while a piece is being read
 * or got ready, so its progress shows; its maker and the home's owners and admins add pasted text in the editor, add
 * a file (uploaded to KNOWLEDGE_FOLDER first), open a piece to read or change it, remove one, or try a failed one
 * again. A refusal shows in the server's words: the editor's under its box, the rest through onFailure.
 * @param {{
 *   bot: () => import("../../types.js").Bot,
 *   isGroup: import("vue").ComputedRef<boolean>,
 *   tab: import("vue").ComputedRef<string>,
 *   onFailure: (error: unknown) => void
 * }} options
 */
export function useBotKnowledge({ bot, isGroup, tab, onFailure }) {
  const known = ref(null);
  const loadFailed = ref(false);
  const adding = ref("");
  const removing = ref(null);
  // The editor: a new piece of text (id null) or one opened, with its text once read.
  const editor = ref(null);
  const pieces = computed(() => known.value?.pieces || []);
  const summary = computed(() => knowledgeSummary(known.value));
  const busy = computed(() => pieces.value.some((piece) => piece.state === "reading" || (piece.state === "indexing" && piece.mode !== "mind")));

  let timer = null;
  const stopPolling = () => {
    clearTimeout(timer);
    timer = null;
  };
  function pollWhileBusy() {
    stopPolling();
    if (busy.value && tab.value === "details") timer = setTimeout(load, POLL_MS);
  }

  /** The list as the server answers it, for this bot only. */
  function show(botId, list) {
    if (bot().id !== botId) return;
    known.value = list;
    loadFailed.value = false;
    pollWhileBusy();
  }

  async function load() {
    if (isGroup.value) return;
    const botId = bot().id;
    try {
      show(botId, await botsApi.knowledge(botId));
    } catch (error) {
      if (bot().id === botId) loadFailed.value = true;
      onFailure(error);
    }
  }

  function openNew() {
    editor.value = { id: null, kind: "text", title: "", text: "", original: "", loading: false, saving: false, problem: "" };
  }

  async function openPiece(piece) {
    const botId = bot().id;
    editor.value = { id: piece.id, kind: piece.kind, title: piece.title, text: "", original: "", filePath: piece.filePath, loading: true, saving: false, problem: "" };
    try {
      const read = await botsApi.knowledgePiece(botId, piece.id);
      if (editor.value?.id === piece.id) Object.assign(editor.value, { text: read.text, original: read.text, loading: false });
    } catch (error) {
      if (editor.value?.id === piece.id) Object.assign(editor.value, { loading: false, problem: error?.message || "That couldn't be opened. Try again." });
    }
  }

  async function saveEditor() {
    const open = editor.value;
    if (!open || open.saving) return;
    const botId = bot().id;
    open.saving = true;
    open.problem = "";
    try {
      const changes = open.kind === "text" && open.text !== open.original ? { title: open.title, text: open.text } : { title: open.title };
      show(botId, open.id ? await botsApi.changeKnowledge(botId, open.id, changes) : await botsApi.addKnowledge(botId, { title: open.title, text: open.text }));
      editor.value = null;
    } catch (error) {
      open.problem = error?.message || "That didn't save. Try again.";
      open.saving = false;
    }
  }

  /** Uploads each file to the bot's Knowledge folder, then adds it; the list shows it being read. */
  async function addFiles(files) {
    const botId = bot().id;
    for (const file of files) {
      adding.value = file.name;
      try {
        const uploaded = await uploadFile(botId, file, KNOWLEDGE_FOLDER);
        show(botId, await botsApi.addKnowledge(botId, { title: file.name, file: uploaded.path }));
      } catch (error) {
        onFailure(error);
      }
    }
    adding.value = "";
  }

  async function confirmRemove() {
    const piece = removing.value;
    if (!piece) return;
    const botId = bot().id;
    try {
      show(botId, await botsApi.removeKnowledge(botId, piece.id));
    } catch (error) {
      onFailure(error);
    }
    removing.value = null;
  }

  async function retry(piece) {
    const botId = bot().id;
    try {
      show(botId, await botsApi.retryKnowledge(botId, piece.id));
    } catch (error) {
      onFailure(error);
    }
  }

  let knownFor = null;
  watch([() => bot().id, tab], () => {
    if (bot().id !== knownFor) {
      known.value = null;
      loadFailed.value = false;
      editor.value = null;
      removing.value = null;
    }
    knownFor = bot().id;
    if (tab.value === "details") load();
    else stopPolling();
  }, { immediate: true });
  onBeforeUnmount(stopPolling);

  return { known, loadFailed, pieces, summary, adding, editor, removing, load, openNew, openPiece, saveEditor, addFiles, confirmRemove, retry };
}
