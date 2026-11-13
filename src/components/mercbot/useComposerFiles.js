import { uploadFile } from "./filesApi.js";

// Text files up to 200 KB are read so the bot can see them.
const TEXT_TYPES = /^(text\/|application\/(json|xml|csv|x-yaml|javascript))/u;

/**
 * Attach files. In a bot's own chat each file is kept in its folder, so it can read any
 * kind and come back to it later; a file that doesn't upload is left out.
 * @param {{
 *   attachments: import("vue").Ref<Array<Record<string, any>>>,
 *   ownChat: () => import("../../types.js").Bot | null,
 *   focusComposer: () => void,
 *   onFailure: (error: unknown) => void
 * }} options `ownChat` is the bot whose folder keeps the files, or null in a group or the picker.
 */
export function useComposerFiles({ attachments, ownChat, focusComposer, onFailure }) {
  async function addFiles(event) {
    for (const file of event.target.files || []) {
      const entry = { id: `${file.name}-${file.size}-${Date.now()}`, name: file.name, size: file.size, type: file.type };
      if ((TEXT_TYPES.test(file.type) || /\.(md|txt|csv|json|ya?ml)$/iu.test(file.name)) && file.size <= 200000) {
        entry.text = await file.text();
      }
      const bot = ownChat();
      if (bot) {
        try {
          entry.path = (await uploadFile(bot.id, file)).path;
        } catch (error) {
          onFailure(error);
          continue;
        }
      }
      attachments.value = [...attachments.value, entry];
    }
    event.target.value = "";
    focusComposer();
  }

  return { addFiles };
}
