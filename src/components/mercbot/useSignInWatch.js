import { onBeforeUnmount, ref } from "vue";
import { pluginsApi } from "./pluginsApi.js";

/**
 * The sign-in opens in a new tab (D-31); the screen checks the account every few seconds, and shows
 * how it stands, until it's connected, for up to 10 minutes or until the screen closes. On a copy
 * only reachable from its own machine (Preview, a home server), the provider can't send the browser
 * back, so the person pastes the address they ended on (D-31). An app that lists its own actions (D-34) has them only
 * once someone has signed in, so its Tools come with one read of the whole list (`reload`) once it's connected.
 * @param {{ open: import("vue").Ref<boolean>, plugins: import("vue").Ref<Array<import("../../types.js").Plugin>>, showToast: (text: string) => void, reload: () => Promise<void> }} options
 */
export function useSignInWatch({ open, plugins, showToast, reload }) {
  let watching = null;
  const pasteSignIn = ref(false);
  const pastedAddress = ref("");
  const pasteProblem = ref("");
  const finishing = ref(false);

  /** Waits for the account `target` of `plugin` to connect after its sign-in opened. */
  function watchSignIn(plugin, target) {
    pastedAddress.value = "";
    clearInterval(watching);
    // Without an account the sign-in tab says to add the app first: nothing to wait for.
    if (!target) return;
    const started = Date.now();
    watching = setInterval(async () => {
      if (!open.value || Date.now() - started > 10 * 60000) {
        clearInterval(watching);
        return;
      }
      const now = (await pluginsApi.account(target.id).catch(() => null))?.account;
      if (!now) return;
      plugins.value = plugins.value.map((entry) => (entry.id === plugin.id
        ? { ...entry, accounts: entry.accounts.map((account) => (account.id === now.id ? now : account)) }
        : entry));
      if (now.status === "connected") {
        clearInterval(watching);
        showToast(`${plugin.name} is connected${now.label ? ` as ${now.label}` : ""}.`);
        if (plugin.mcp) await reload();
      }
    }, 3000);
  }

  async function finishSignIn() {
    finishing.value = true;
    pasteProblem.value = "";
    try {
      const result = await pluginsApi.finishSignIn(pastedAddress.value);
      plugins.value = result.plugins;
      clearInterval(watching);
      pastedAddress.value = "";
      showToast(`${result.provider} is connected${result.label ? ` as ${result.label}` : ""}.`);
    } catch (error) {
      pasteProblem.value = error?.message || "That didn't work. Start again with Sign in.";
    } finally {
      finishing.value = false;
    }
  }

  onBeforeUnmount(() => clearInterval(watching));
  return { pasteSignIn, pastedAddress, pasteProblem, finishing, watchSignIn, finishSignIn };
}
