import { computed, ref } from "vue";
import { filesApi } from "../mercbot/filesApi.js";
import { nameOf, widerQuestion } from "./filePlaces.js";

/**
 * Copying and moving files and folders between places (filePlaces.js items), as Copy to…, Move to…, a drop and Add
 * from files do it: a move inside one place is the place's own move (a rename's route); anything else is a transfer,
 * which the server refuses with 409 `files_wider_needs_confirm` when it would let more people see a private chat's
 * file. Then the person is asked (`question`, answered by `confirm` or by closing it), and a yes sends it again,
 * confirmed. A refusal is reported, in the server's words where it has them.
 * @param {{ report: (error: unknown, fallback: string) => void }} options
 */
export function useFileTransfer({ report }) {
  const question = ref("");
  const busy = ref(false);
  let answer = null;

  function settle(yes) {
    const resolve = answer;
    answer = null;
    question.value = "";
    if (resolve) resolve(yes);
  }
  // The confirmation's v-model: closing it without Continue is a no.
  const asking = computed({ get: () => Boolean(question.value), set: (open) => { if (!open) settle(false); } });
  const confirm = () => settle(true);
  const ask = (to) => new Promise((resolve) => {
    answer = resolve;
    question.value = widerQuestion(to);
  });

  async function send({ mode, from, path, to, folder }) {
    if (mode === "move" && from.key === to.key) {
      const target = `${folder}/${nameOf(path)}`;
      if (target === path) return path;
      return (await filesApi.move(from.botId, path, target, from.chat)).path;
    }
    const request = { mode, from: { place: from.place, path }, to: { place: to.place, folder } };
    try {
      return (await filesApi.transfer(request)).path;
    } catch (error) {
      if (error?.code !== "files_wider_needs_confirm") throw error;
      if (!(await ask(to))) return null;
      return (await filesApi.transfer({ ...request, confirmed: true })).path;
    }
  }

  /**
   * Copies or moves `path` from the place `from` into `folder` of the place `to`: its new path, or null when the person
   * said no or it was refused (and reported).
   * @param {{ mode: "copy" | "move", from: Record<string, any>, path: string, to: Record<string, any>, folder: string }} request
   */
  async function transfer(request) {
    busy.value = true;
    try {
      return await send(request);
    } catch (error) {
      report(error, request.mode === "copy" ? "That couldn't be copied." : "That couldn't be moved.");
      return null;
    } finally {
      busy.value = false;
    }
  }

  return { question, asking, busy, confirm, transfer };
}
