import { nameOf } from "../files/filePlaces.js";
import { uploadFile } from "./filesApi.js";

// Text files up to 200 KB are read so the bot can see them.
const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|x-yaml|javascript))/u;

/** Where a file attached in a chat is kept: the chat's folder (D-112 R6), which everyone who can open the chat can. */
const CHAT_UPLOADS = "/files/chat/Uploads";

/** One file into a chat's folder, through the chat's first bot when it has one: its path there. */
async function uploadTo(chat, file) {
  const botId = chat.bots?.[0]?.botId ?? null;
  return (await uploadFile(botId == null ? null : String(botId), file, CHAT_UPLOADS, String(chat.id))).path;
}

/**
 * Attach files. Each file is kept in the open chat's folder, so its bots can read any kind and come back to it later; a
 * file the server refuses is left out, and the refusal reported in its own words. Add from files attaches files from
 * any place the person can open the same way: each is copied into the chat's Uploads first (the original stays where it
 * was), through `transfer` (useFileTransfer's, which asks before a private chat's file goes where more people see it,
 * and reports a refusal), and a file not copied is left out.
 * @param {{
 *   attachments: import("vue").Ref<Array<Record<string, any>>>,
 *   chat: () => import("../../types.js").Chat | null,
 *   focusComposer: () => void,
 *   onFailure: (error: unknown) => void,
 *   transfer: (request: Record<string, any>) => Promise<string | null>
 * }} options `chat` is the open chat (the composer shows only in one)
 */
export function useComposerFiles({ attachments, chat, focusComposer, onFailure, transfer }) {
  /** Attaches these files (File objects): chosen here, or shared in from another app (D-133). */
  async function addFileList(files) {
    for (const file of files) {
      const entry = { id: `${file.name}-${file.size}-${Date.now()}`, name: file.name, size: file.size, type: file.type };
      if ((TEXT_TYPES.test(file.type) || /\.(md|txt|csv|json|ya?ml)$/iu.test(file.name)) && file.size <= 200000) {
        entry.text = await file.text();
      }
      try {
        entry.path = await uploadTo(chat(), file);
      } catch (error) {
        onFailure(error);
        continue;
      }
      attachments.value = [...attachments.value, entry];
    }
    focusComposer();
  }

  async function addFiles(event) {
    const chosen = [...(event.target.files || [])];
    event.target.value = "";
    await addFileList(chosen);
  }

  /**
   * Files chosen in the place picker ({ item, path, size }: item is the place, filePlaces.js), copied into this chat
   * (`to`, its place) and attached.
   */
  async function addCopies(chosen, to) {
    for (const file of chosen) {
      const path = await transfer({ mode: "copy", from: file.item, path: file.path, to, folder: CHAT_UPLOADS });
      if (!path) continue;
      attachments.value = [...attachments.value, { id: `${path}-${Date.now()}`, name: nameOf(path), size: file.size, type: "", path }];
    }
    focusComposer();
  }

  return { addFiles, addFileList, addCopies };
}
