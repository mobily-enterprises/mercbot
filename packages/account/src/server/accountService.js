import { resolveActorId, resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { hasPermission } from "@jskit-ai/kernel/shared/support";
import { passedOn, resolveWorkspaceScopeValue } from "@jskit-ai/resource-runtime/server";
import { AccountError } from "./accountError.js";
import { vaultKey } from "./vaultCrypto.js";
import { vaultEntry } from "./vaultEntry.js";
import { readContactPhoto } from "./vaultPhoto.js";
import { VAULT_IMPORT_LIMIT } from "../shared/vault.js";

/**
 * A Vault record as the Vault page shows it, without its sealed secret, with who added it (null once their account
 * went).
 * @param {Record<string, any>} record
 */
function toItem(record) {
  return {
    id: String(record.id),
    kind: record.kind,
    label: record.label,
    data: { ...record.data, secret: undefined },
    madeBy: record.madeBy == null ? null : String(record.madeBy),
    createdAt: new Date(record.createdAt).toISOString()
  };
}

/**
 * The account menu's services (D-16, D-17, D-61): who runs this copy and the home's Vault (D8: used in any chat of the
 * home, as the person who asked; anyone in the home adds to it). What work uses is recorded
 * through the meter (meter.js, usage.js), and what a home has spent is spending.js's. Every method takes the call's
 * options last.
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources this feature's handles
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {{ runsThisCopy: (userId: string, options: object) => Promise<boolean> } | null} dependencies.copyRunners who runs
 *   this copy (`mercbot.copy-runners`): its one person (@local/single-user) or a copy built on Mercbot's own, or null
 */
export function createAccountService({ resources, env, copyRunners }) {
  const { vaultItems } = resources;
  const key = vaultKey(env);

  /**
   * The options for the home's Vault (D8): a request in the home, or a job in it acting for a person (a bot's turn, as
   * the person who asked). Never without a home, which would be no home's Vault.
   */
  function inHome(options) {
    if (!resolveWorkspaceScopeValue(options?.context)) throw new Error("account: the Vault is a home's: the call needs its home.");
    return passedOn(options);
  }

  /** Who adds an item: the signed-in person, or the person a bot's turn works for. */
  function maker(options) {
    const person = resolveActorId(options?.context) ?? resolveAuditActorId(options?.context);
    if (!person) throw new Error("account: an item goes in the Vault as someone: a signed-in person or a job acting for one.");
    return String(person);
  }

  /**
   * Whether a person runs this copy, and so may do what only its runners may (a website in a folder on its computer,
   * D-84): whom `mercbot.copy-runners` names, Mercbot's one person (D-81, @local/single-user) or a copy built on
   * Mercbot's own runners; without it, nobody.
   * @param {string | number | null} userId
   * @param {object} options
   */
  async function runsThisCopy(userId, options) {
    if (!userId || !copyRunners) return false;
    return copyRunners.runsThisCopy(String(userId), options);
  }

  /** The home's Vault, newest first. */
  async function vault(options) {
    return { items: (await vaultItems.queryAll({ sort: ["-id"] }, inHome(options))).map(toItem) };
  }

  async function addVaultItem(input, options) {
    const entry = vaultEntry(input, key);
    const record = await vaultItems.create({ kind: input.kind, label: entry.label, data: entry.data, madeBy: maker(options) }, inHome(options));
    return { item: toItem(record) };
  }

  /**
   * Items from a CSV file the person chose (Import from a CSV file), all of one kind: every one is
   * checked and sealed like an item added by hand, and either all are saved or none. Each names its
   * row in the file, so a refusal says which row to fix.
   * @param {{ kind?: string, items?: Array<{ row?: number, data?: Record<string, unknown> }> }} input
   * @param {object} options
   */
  async function importVaultItems(input, options) {
    const rows = Array.isArray(input.items) ? input.items : [];
    if (!rows.length || rows.length > VAULT_IMPORT_LIMIT) {
      throw new AccountError(400, `Send from 1 to ${VAULT_IMPORT_LIMIT} items at a time.`, {
        code: "account_vault_import_size",
        params: { most: VAULT_IMPORT_LIMIT }
      });
    }
    const madeBy = maker(options);
    const entries = rows.map((item, index) => {
      const row = Number.isSafeInteger(item?.row) ? item.row : index + 1;
      try {
        return { kind: input.kind, ...vaultEntry({ kind: input.kind, data: item?.data }, key), madeBy };
      } catch (error) {
        if (error instanceof AccountError && error.statusCode === 400) {
          throw new AccountError(400, `Row ${row}: ${error.message}`, { code: error.code, params: { row } });
        }
        throw error;
      }
    });
    const records = await vaultItems.createMany(entries, { ...inHome(options), returning: "records" });
    return { items: records.map(toItem) };
  }

  /**
   * Contact details read from a photo (Scan with camera, Upload a photo), for the person to check
   * before saving; nothing is kept.
   * @param {{ data: Buffer, type: string }} photo
   */
  async function readVaultPhoto(photo) {
    return readContactPhoto(env, photo);
  }

  /**
   * An item out of the home's Vault: by the person who added it, or one of the home's owners or admins (403 otherwise);
   * one that isn't there is already gone.
   */
  async function deleteVaultItem(itemId, options) {
    const id = String(itemId ?? "");
    if (!/^\d+$/u.test(id)) return { deleted: id };
    const found = await vaultItems.get(id, { fields: ["madeBy"] }, { ...inHome(options), missing: "skip" });
    if (!found) return { deleted: id };
    const manages = hasPermission(options?.context?.permissions || [], "workspace.settings.update");
    if (String(found.madeBy ?? "") !== maker(options) && !manages) {
      throw new AccountError(403, "Only the person who added this, or the home's owners and admins, can delete it.", { code: "account_vault_delete_forbidden" });
    }
    await vaultItems.delete(id, { ...inHome(options), missing: "skip" });
    return { deleted: id };
  }

  /**
   * The home's saved logins (D-17, D8), newest first, with their sealed secrets, for filling into a
   * chat's computer (bots vaultLogins.js).
   * @param {object} options
   * @returns {Promise<Array<{ id: string, label: string, data: Record<string, any> }>>}
   */
  async function savedLogins(options) {
    const records = await vaultItems.queryAll({ filters: { kind: "login" }, sort: ["-id"], fields: ["label", "data"] }, inHome(options));
    return records.map((record) => ({ id: String(record.id), label: record.label, data: record.data || {} }));
  }

  /** One of the home's saved logins, or null. */
  async function savedLogin(id, options) {
    const found = /^\d+$/u.test(String(id ?? ""))
      ? (await vaultItems.queryAll({ filters: { id: String(id), kind: "login" }, fields: ["label", "data"] }, inHome(options)))[0]
      : null;
    return found ? { id: String(found.id), label: found.label, data: found.data || {} } : null;
  }

  /**
   * A login the person gave through the secure form, saved in the home's Vault for next time, as theirs
   * (bots vaultLogins.js): `data` carries its sealed secret.
   * @param {{ label: string, data: Record<string, any> }} login
   * @param {object} options
   * @returns {Promise<{ id: string, label: string }>}
   */
  async function saveLogin({ label, data }, options) {
    const id = await vaultItems.create({ kind: "login", label, data, madeBy: maker(options) }, { ...inHome(options), returning: "id" });
    return { id: String(id), label };
  }

  return Object.freeze({
    runsThisCopy,
    vault,
    addVaultItem,
    importVaultItems,
    readVaultPhoto,
    deleteVaultItem,
    savedLogins,
    savedLogin,
    saveLogin
  });
}
