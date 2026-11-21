import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { onBeforeUnmount, ref, watch } from "vue";
import { homePath } from "./homeApi.js";
import { placeQuery } from "./chatPlace.js";

// A bot's computer in a chat (D14, D16): wake it, stream its screen, send the person's input, and a person taking it
// over and handing it back. Each bot in a chat has its own computer, which belongs to that chat.
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });

// A computer is a bot's in a chat ({ id, chat }); a bare bot id means its computer in the open chat (chatPlace.js).
const at = (target, path) => {
  const { id, chat } = typeof target === "object" && target ? target : { id: target };
  const where = placeQuery({ chat });
  return homePath(`/bots/${id}${path}${where ? `?${where}` : ""}`);
};
const post = (target, path) => client.request(at(target, path), { method: "POST", body: {} });

export const computerApi = {
  // { state, url, error, signIns: [{ label, kind: "site" | "coding" | "sedna", since }], control: { userId, name, since }
  // | null }: what's signed in on it, and the person who has taken it over, if anyone.
  status: (target) => client.request(at(target, "/computer")),
  wake: (target) => post(target, "/computer/wake"),
  ticket: (target) => post(target, "/computer/ticket"),
  // A fresh start for this computer alone, for anyone who can open its chat: its status.
  reset: (target) => post(target, "/computer/reset"),
  // A person takes the computer over from its bot (or from another person), and the bot doesn't act on it until it's
  // handed back (D16); each posts a line in the chat and answers { messages, control }. Handing back twice is no harm.
  takeOver: (target) => post(target, "/computer/take-over"),
  handBack: (target) => post(target, "/computer/hand-back")
};

// A bot's screenshots are from its computer in the chat they were taken in.
export const screenshotUrl = (botId, name, chat = undefined) => {
  const where = placeQuery({ chat });
  return homePath(`/bots/${botId}/screenshots/${encodeURIComponent(name)}${where ? `?${where}` : ""}`);
};

/**
 * Live state and address of a bot's computer while `active` is true. The screen is VNC.
 * @param {import("vue").Ref<string | { id: string, chat: string }>} botIdRef The bot and the chat whose computer it
 *   is, or a bot id for its computer in the open chat.
 * @param {import("vue").Ref<boolean>} activeRef Whether the screen is shown.
 */
export function useComputerStream(botIdRef, activeRef) {
  const state = ref("asleep");
  const url = ref("");
  const error = ref("");
  let source = null;

  function close() {
    source?.close();
    source = null;
  }

  function open(botId) {
    close();
    source = new EventSource(at(botId, "/computer/stream"));
    source.addEventListener("state", (event) => {
      const data = JSON.parse(event.data);
      state.value = data.state;
      url.value = data.url || url.value;
      error.value = data.error || "";
    });
    source.addEventListener("url", (event) => { url.value = JSON.parse(event.data).url; });
  }

  watch([botIdRef, activeRef], ([botId, active]) => {
    if (botId && active) open(botId);
    else close();
  }, { immediate: true });

  onBeforeUnmount(close);
  return { state, url, error };
}
