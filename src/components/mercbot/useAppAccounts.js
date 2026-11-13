import { ref } from "vue";
import { pluginsApi } from "./pluginsApi.js";

/**
 * The accounts on an app's page (D-37): disconnecting asks once more in the
 * row, so a stray click can't cut an account off; "+ Add another account" asks for a label (work,
 * personal), then signs it in; names edit in place, where Enter or leaving the field saves and
 * Escape cancels. A home's account is changed only by the home's owners and admins.
 * @param {{
 *   plugins: import("vue").Ref<Array<import("../../types.js").Plugin>>,
 *   managesHome: import("vue").Ref<boolean>,
 *   signIn: (plugin: import("../../types.js").Plugin, account: Record<string, any>) => void,
 *   onFailure: (error: unknown) => void
 * }} options
 */
export function useAppAccounts({ plugins, managesHome, signIn, onFailure }) {
  const newAccountLabel = ref("");
  const addingAccount = ref(false);
  const forHome = ref(false);
  const removingAccount = ref("");
  const confirmingDisconnect = ref("");

  async function disconnect(account) {
    confirmingDisconnect.value = "";
    try {
      plugins.value = (await pluginsApi.disconnect(account.id)).plugins;
    } catch (error) {
      onFailure(error);
    }
  }

  async function removeAccount(account) {
    removingAccount.value = "";
    try {
      plugins.value = (await pluginsApi.removeAccount(account.id)).plugins;
    } catch (error) {
      onFailure(error);
    }
  }

  const canChange = (account) => !account.home || managesHome.value;

  function startAddAccount(plugin) {
    newAccountLabel.value = "";
    // Without the app added for themselves, an owner or admin adds one for the home.
    forHome.value = !plugin.installed;
    addingAccount.value = true;
  }

  async function authorizeNewAccount(plugin) {
    const label = newAccountLabel.value.trim();
    if (!label) return;
    try {
      const result = await pluginsApi.addAccount(plugin.id, label, forHome.value);
      plugins.value = result.plugins;
      addingAccount.value = false;
      const updated = result.plugins.find((entry) => entry.id === plugin.id);
      signIn(updated, updated.accounts.find((entry) => entry.id === result.accountId));
    } catch (error) {
      onFailure(error);
    }
  }

  const renamingAccountId = ref("");
  const accountName = ref("");

  function startAccountRename(account) {
    renamingAccountId.value = account.id;
    accountName.value = account.name;
  }

  async function commitAccountRename(account) {
    if (renamingAccountId.value !== account.id) return;
    renamingAccountId.value = "";
    const name = accountName.value.trim();
    if (!name || name === account.name) return;
    try {
      plugins.value = (await pluginsApi.renameAccount(account.id, name)).plugins;
    } catch (error) {
      onFailure(error);
    }
  }

  return {
    newAccountLabel, addingAccount, forHome, removingAccount, confirmingDisconnect, disconnect, removeAccount, canChange,
    startAddAccount, authorizeNewAccount, renamingAccountId, accountName, startAccountRename, commitAccountRename
  };
}
