import { onBeforeUnmount, ref } from "vue";
import { pluginsApi } from "./pluginsApi.js";
import { listenForSignIns } from "./signInReturn.js";

/**
 * The sign-in opens in a window of its own (D-31, D-110); the screen checks the account at once when that window says
 * it's done, and every few seconds besides, and shows how it stands, until it's connected, for up to 10 minutes or until
 * the screen closes. On a copy
 * only reachable from its own machine (Preview, a home server), the provider can't send the browser
 * back, so the person pastes the address they ended on (D-31). An app that lists its own actions (D-34) has them only
 * once someone has signed in, so its Tools come with one read of the whole list (`reload`) once it's connected.
 * @param {{ open: import("vue").Ref<boolean>, plugins: import("vue").Ref<Array<import("../../types.js").Plugin>>, showToast: (text: string) => void, reload: () => Promise<void> }} options
 */
export function useSignInWatch({ open, plugins, showToast, reload }) {
  let watching = null;
  /** Stops listening for the sign-in window, while there is one to wait for. */
  let stopListening = () => {};
  const pasteSignIn = ref(false);
  const pastedAddress = ref("");
  const pasteProblem = ref("");
  const finishing = ref(false);

  /** Waits for the account `target` of `plugin` to connect after its sign-in opened. */
  function watchSignIn(plugin, target) {
    pastedAddress.value = "";
    stopWatching();
    // Without an account the sign-in window says to add one first: nothing to wait for.
    if (!target) return;
    const started = Date.now();
    let done = false;
    const check = async () => {
      if (done) return;
      if (!open.value || Date.now() - started > 10 * 60000) {
        stopWatching();
        return;
      }
      const now = (await pluginsApi.account(target.id).catch(() => null))?.account;
      if (!now || done) return;
      plugins.value = plugins.value.map((entry) => (entry.id === plugin.id
        ? { ...entry, accounts: entry.accounts.map((account) => (account.id === now.id ? now : account)) }
        : entry));
      if (now.status === "connected") {
        done = true;
        stopWatching();
        showToast(`${plugin.name} is connected${now.label ? ` as ${now.label}` : ""}.`);
        if (plugin.mcp) await reload();
      }
    };
    watching = setInterval(check, 3000);
    stopListening = listenForSignIns(check);
  }

  function stopWatching() {
    clearInterval(watching);
    stopListening();
    stopListening = () => {};
  }

  async function finishSignIn() {
    finishing.value = true;
    pasteProblem.value = "";
    try {
      const result = await pluginsApi.finishSignIn(pastedAddress.value);
      plugins.value = result.plugins;
      stopWatching();
      pastedAddress.value = "";
      showToast(`${result.provider} is connected${result.label ? ` as ${result.label}` : ""}.`);
    } catch (error) {
      pasteProblem.value = error?.message || "That didn't work. Start again with Sign in.";
    } finally {
      finishing.value = false;
    }
  }

  onBeforeUnmount(stopWatching);
  return { pasteSignIn, pastedAddress, pasteProblem, finishing, watchSignIn, finishSignIn };
}
