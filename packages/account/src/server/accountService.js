import { resolveActorId, resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { passedOn, resolveUserScopeValue } from "@jskit-ai/resource-runtime/server";
import { AccountError } from "./accountError.js";
import { vaultKey } from "./vaultCrypto.js";
import { vaultEntry } from "./vaultEntry.js";
import { readContactPhoto } from "./vaultPhoto.js";
import { VAULT_IMPORT_LIMIT } from "../shared/vault.js";

/**
 * A Vault record as the account menu shows it, without its sealed secret.
 * @param {Record<string, any>} record
 */
function toItem(record) {
  return {
    id: String(record.id),
    kind: record.kind,
    label: record.label,
    data: { ...record.data, secret: undefined },
    createdAt: new Date(record.createdAt).toISOString()
  };
}

/**
 * The account menu's services (D-16, D-17, D-61): who runs this copy and the Vault. What work uses is recorded
 * through the meter (meter.js, usage.js), and what a home has spent is spending.js's. Every method takes the call's
 * options last.
 * @param {object} dependencies
 * @param {Record<string, any>} dependencies.resources this feature's handles
 * @param {(reason: string) => object} dependencies.systemContext the feature's system scope
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {{ runsThisCopy: (userId: string, options: object) => Promise<boolean> } | null} dependencies.copyRunners who runs
 *   this copy (`mercbot.copy-runners`): its one person (@local/single-user) or a copy built on Mercbot's own, or null
 */
export function createAccountService({ resources, systemContext, env, copyRunners }) {
  const { vaultItems } = resources;
  const key = vaultKey(env);

  /**
   * The options for the person's own Vault: a request's are its own, and so are a job's already
   * scoped to the person. A home's job acting for a person (a bot's turn) reads and writes their
   * Vault, and only theirs, through a context for that person.
   */
  function own(options) {
    if (resolveActorId(options?.context)) return passedOn(options);
    const person = resolveAuditActorId(options?.context);
    if (!person) throw new Error("account: a person's Vault needs a signed-in person or a job acting for one.");
    if (String(resolveUserScopeValue(options?.context) ?? "") === String(person)) return passedOn(options);
    return { ...passedOn(options), context: systemContext("read and save a person's own Vault logins for a bot's turn acting for them").forUser(person) };
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

  async function vault(options) {
    return { items: (await vaultItems.queryAll({ sort: ["-id"] }, passedOn(options))).map(toItem) };
  }

  async function addVaultItem(input, options) {
    const entry = vaultEntry(input, key);
    const record = await vaultItems.create({ kind: input.kind, label: entry.label, data: entry.data }, passedOn(options));
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
    const entries = rows.map((item, index) => {
      const row = Number.isSafeInteger(item?.row) ? item.row : index + 1;
      try {
        return { kind: input.kind, ...vaultEntry({ kind: input.kind, data: item?.data }, key) };
      } catch (error) {
        if (error instanceof AccountError && error.statusCode === 400) {
          throw new AccountError(400, `Row ${row}: ${error.message}`, { code: error.code, params: { row } });
        }
        throw error;
      }
    });
    const records = await vaultItems.createMany(entries, { ...passedOn(options), returning: "records" });
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

  async function deleteVaultItem(itemId, options) {
    const id = String(itemId ?? "");
    if (/^\d+$/u.test(id)) await vaultItems.delete(id, { ...passedOn(options), missing: "skip" });
    return { deleted: id };
  }

  /**
   * The person's saved logins (D-17), newest first, with their sealed secrets, for filling into a
   * bot's browser (bots vaultLogins.js).
   * @param {object} options
   * @returns {Promise<Array<{ id: string, label: string, data: Record<string, any> }>>}
   */
  async function savedLogins(options) {
    const records = await vaultItems.queryAll({ filters: { kind: "login" }, sort: ["-id"], fields: ["label", "data"] }, own(options));
    return records.map((record) => ({ id: String(record.id), label: record.label, data: record.data || {} }));
  }

  /** One of the person's saved logins, or null. */
  async function savedLogin(id, options) {
    const found = /^\d+$/u.test(String(id ?? ""))
      ? (await vaultItems.queryAll({ filters: { id: String(id), kind: "login" }, fields: ["label", "data"] }, own(options)))[0]
      : null;
    return found ? { id: String(found.id), label: found.label, data: found.data || {} } : null;
  }

  /**
   * A login the person gave through the secure form, saved for next time (bots vaultLogins.js):
   * `data` carries its sealed secret.
   * @param {{ label: string, data: Record<string, any> }} login
   * @param {object} options
   * @returns {Promise<{ id: string, label: string }>}
   */
  async function saveLogin({ label, data }, options) {
    const id = await vaultItems.create({ kind: "login", label, data }, { ...own(options), returning: "id" });
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
