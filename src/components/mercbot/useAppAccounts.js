import { ref } from "vue";
import { pluginsApi } from "./pluginsApi.js";

/**
 * The home's accounts on an app's page (D-110, D-111): every line has a bin, which asks once more in the row so a stray
 * click can't remove an account, and removing withdraws its sign-in; "+ Add account" opens the Add account step (a
 * label, if any), then signs it in; names edit in place, where Enter or leaving the field saves and Escape cancels. An
 * account is changed by the person who added it and the home's owners and admins.
 * @param {{
 *   plugins: import("vue").Ref<Array<import("../../types.js").Plugin>>,
 *   signIn: (plugin: import("../../types.js").Plugin, account: Record<string, any>) => void,
 *   onFailure: (error: unknown) => void
 * }} options
 */
export function useAppAccounts({ plugins, signIn, onFailure }) {
  const addingAccount = ref(false);
  const adding = ref(false);
  const removingAccount = ref("");

  async function removeAccount(account) {
    removingAccount.value = "";
    try {
      plugins.value = (await pluginsApi.removeAccount(account.id)).plugins;
    } catch (error) {
      onFailure(error);
    }
  }

  /** The Add account step's answer: the account is made, then signed in (or its credentials entered). */
  async function addAccount(plugin, { label }) {
    adding.value = true;
    try {
      const result = await pluginsApi.addAccount(plugin.id, label);
      plugins.value = result.plugins;
      addingAccount.value = false;
      const updated = result.plugins.find((entry) => entry.id === plugin.id);
      signIn(updated, updated.accounts.find((entry) => entry.id === result.accountId));
    } catch (error) {
      onFailure(error);
    } finally {
      adding.value = false;
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
    addingAccount, adding, removingAccount, removeAccount, addAccount,
    renamingAccountId, accountName, startAccountRename, commitAccountRename
  };
}
