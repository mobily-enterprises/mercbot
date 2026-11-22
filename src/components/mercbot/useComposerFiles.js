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
 * Attach files. Each file is kept in the open chat's folder, so its bots can read any kind and come back to it later; a
 * file the server refuses is left out, and the refusal reported in its own words.
 * @param {{
 *   attachments: import("vue").Ref<Array<Record<string, any>>>,
 *   chat: () => import("../../types.js").Chat | null,
 *   focusComposer: () => void,
 *   onFailure: (error: unknown) => void
 * }} options `chat` is the open chat (the composer shows only in one)
 */
export function useComposerFiles({ attachments, chat, focusComposer, onFailure }) {
  async function addFiles(event) {
    for (const file of event.target.files || []) {
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
    event.target.value = "";
    focusComposer();
  }

  return { addFiles };
}
