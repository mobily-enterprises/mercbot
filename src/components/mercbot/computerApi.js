import { createHttpClient } from "@jskit-ai/http-runtime/client";
import { AUTH_PATHS } from "@jskit-ai/auth-core/shared/authPaths";
import { onBeforeUnmount, ref, watch } from "vue";
import { homePath } from "./homeApi.js";

// The bot's computer: wake it, stream its screen, and send the person's input.
const client = createHttpClient({ credentials: "include", csrf: { sessionPath: AUTH_PATHS.SESSION } });

// A computer is a bot's (its id), or in a group the bot's own one for that group ({ id, group },
// D-46).
const at = (target, path) => {
  const { id, group = null } = typeof target === "object" && target ? target : { id: target };
  return homePath(`/bots/${id}${path}${group ? `?group=${encodeURIComponent(group)}` : ""}`);
};

export const computerApi = {
  wake: (target) => client.request(at(target, "/computer/wake"), { method: "POST", body: {} }),
  ticket: (target) => client.request(at(target, "/computer/ticket"), { method: "POST", body: {} }),
  settleHandover: (botId, messageId, outcome) =>
    client.request(homePath(`/bots/${botId}/handover/${messageId}`), { method: "POST", body: { outcome } })
};

// In a group, a bot's screenshots are from its own computer for that group (D-46).
export const screenshotUrl = (botId, name, group = null) => homePath(`/bots/${botId}/screenshots/${encodeURIComponent(name)}${group ? `?group=${encodeURIComponent(group)}` : ""}`);

/**
 * Live state and address of a bot's computer while `active` is true. The screen is VNC.
 * @param {import("vue").Ref<string | { id: string, group: string }>} botIdRef The bot, or in a group
 *   the bot and the group whose computer it is (D-46).
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
