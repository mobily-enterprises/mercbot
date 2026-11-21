import { uploadFile } from "./filesApi.js";

// Text files up to 200 KB are read so the bot can see them.
const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|x-yaml|javascript))/u;

/** Where a file attached in a chat is kept: the chat's folder (D-112 R6), which everyone who can open the chat can. */
export const CHAT_UPLOADS = "/files/chat/Uploads";

/** One file into a chat's folder, through the chat's first bot when it has one: its path there. */
async function uploadTo(chat, file) {
  const botId = chat.bots?.[0]?.botId ?? null;
  return (await uploadFile(botId == null ? null : String(botId), file, CHAT_UPLOADS, String(chat.id))).path;
}

/**
 * New chat's attachments once its chat is made (useNewChat): each file still to keep (`file`, no `path`) goes in the
 * chat's folder as one attached in the chat does, and one the server refuses is left out, `onFailure` told.
 * @param {Array<Record<string, any>>} attachments
 * @param {import("../../types.js").Chat} chat
 * @param {(error: unknown) => void} onFailure
 */
export async function uploadAttached(attachments, chat, onFailure) {
  const kept = [];
  for (const { file, ...entry } of attachments) {
    if (file && !entry.path) {
      try {
        entry.path = await uploadTo(chat, file);
      } catch (error) {
        onFailure(error);
        continue;
      }
    }
    kept.push(entry);
  }
  return kept;
}

/**
 * Attach files. In a chat each file is kept in the chat's folder, so its bots can read any kind and come back to it
 * later; a file the server refuses is left out, and the refusal reported in its own words. In New chat, with no chat
 * yet, each file waits on its attachment (`file`) until the chat is made (uploadAttached).
 * @param {{
 *   attachments: import("vue").Ref<Array<Record<string, any>>>,
 *   chat: () => import("../../types.js").Chat | null,
 *   focusComposer: () => void,
 *   onFailure: (error: unknown) => void
 * }} options `chat` is the open chat, or null where there's none yet.
 */
export function useComposerFiles({ attachments, chat, focusComposer, onFailure }) {
  async function addFiles(event) {
    for (const file of event.target.files || []) {
      const entry = { id: `${file.name}-${file.size}-${Date.now()}`, name: file.name, size: file.size, type: file.type };
      if ((TEXT_TYPES.test(file.type) || /\.(md|txt|csv|json|ya?ml)$/iu.test(file.name)) && file.size <= 200000) {
        entry.text = await file.text();
      }
      const open = chat();
      if (open) {
        try {
          entry.path = await uploadTo(open, file);
        } catch (error) {
          onFailure(error);
          continue;
        }
      } else entry.file = file;
      attachments.value = [...attachments.value, entry];
    }
    event.target.value = "";
    focusComposer();
  }

  return { addFiles };
}
