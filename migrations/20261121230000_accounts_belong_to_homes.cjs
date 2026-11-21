const { createDecipheriv } = require("node:crypto");

/**
 * Every connected account is its home's, and so is every app on a home's list (D-111). A person's own accounts
 * (workspace_id null) each move, the same row with its keys, address and pace, to exactly one home: the home whose
 * files are kept in that Google Drive (Settings → Files, or a move into it that is running), else the one home the
 * person is in besides their first home, else their first home. One whose person is in no home at all can't be reached
 * by anyone and is deleted. Each person's list of added apps (user_plugins) becomes the homes': an app is on the list
 * of every home that holds one of its accounts, added by whoever added the first of them, and an app someone added with
 * no account goes on their first home's list. Then user_plugins goes, workspace_id is required, and a connect card's
 * follow-up no longer says whether it waited in a person's own chat, nor is it looked up by its person. No row makes it
 * fail: a value it can't read (a sealed setting under another key) only skips the Drive step for that home.
 *
 * Settings → Files is sealed under MERCBOT_VAULT_KEY (D-17, packages/account/src/server/vaultCrypto.js), the env the
 * app's migrations run with. With no key no Drive could have been chosen, so the Drive step finds nothing.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.transaction(async (trx) => {
    // An app whose API credentials are the home's keeps one unlabelled account a home (ix_plugin_accounts_home_app_unlabelled);
    // none of them was ever a person's own, but one would still find its place.
    await trx.raw("UPDATE plugin_accounts SET name = 'Sedna ' || id WHERE workspace_id IS NULL AND plugin_id IN ('sedna') AND name = ''");

    for (const [accountId, homeId] of await drivesInUse(trx)) {
      await trx.raw("UPDATE plugin_accounts SET workspace_id = ? WHERE id = ? AND workspace_id IS NULL", [homeId, accountId]);
    }
    // The one home the person is in besides their first home.
    await trx.raw(`
      WITH others AS (
        SELECT m.user_id, min(m.workspace_id) AS home, count(*) AS homes
        FROM workspace_memberships m JOIN workspaces w ON w.id = m.workspace_id
        WHERE m.status = 'active' AND w.deleted_at IS NULL AND NOT (w.is_personal AND w.owner_user_id = m.user_id)
        GROUP BY m.user_id
      )
      UPDATE plugin_accounts a SET workspace_id = o.home FROM others o
      WHERE a.workspace_id IS NULL AND a.user_id = o.user_id AND o.homes = 1
    `);
    await trx.raw(`UPDATE plugin_accounts a SET workspace_id = ${FIRST_HOME} WHERE a.workspace_id IS NULL`);
    await trx.raw("DELETE FROM plugin_accounts WHERE workspace_id IS NULL");

    await trx.raw(`
      CREATE TABLE home_plugins (
        id bigserial PRIMARY KEY,
        workspace_id bigint NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
        plugin_id character varying(64) NOT NULL,
        user_id bigint REFERENCES users (id) ON DELETE SET NULL,
        installed_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
        CONSTRAINT uq_home_plugins UNIQUE (workspace_id, plugin_id)
      )
    `);
    await trx.raw(`
      INSERT INTO home_plugins (workspace_id, plugin_id, user_id, installed_at)
      SELECT DISTINCT ON (a.workspace_id, a.plugin_id) a.workspace_id, a.plugin_id, a.user_id, coalesce(u.installed_at, CURRENT_TIMESTAMP)
      FROM plugin_accounts a LEFT JOIN user_plugins u ON u.user_id = a.user_id AND u.plugin_id = a.plugin_id
      ORDER BY a.workspace_id, a.plugin_id, a.id
    `);
    await trx.raw(`
      INSERT INTO home_plugins (workspace_id, plugin_id, user_id, installed_at)
      SELECT h.home, u.plugin_id, u.user_id, u.installed_at
      FROM user_plugins u CROSS JOIN LATERAL (SELECT ${FIRST_HOME.replaceAll("a.user_id", "u.user_id")} AS home) h
      WHERE h.home IS NOT NULL AND NOT EXISTS (SELECT 1 FROM plugin_accounts a WHERE a.user_id = u.user_id AND a.plugin_id = u.plugin_id)
      ON CONFLICT (workspace_id, plugin_id) DO NOTHING
    `);
    await trx.raw("DROP TABLE user_plugins");
    await trx.raw("ALTER TABLE plugin_accounts ALTER COLUMN workspace_id SET NOT NULL");
    // A connect card's follow-up waited for a person's own account in their own chats; every account is a home's now,
    // so a sign-in marks the follow-ups of its home (ix_connect_follow_ups_home), never a person's.
    await trx.raw("ALTER TABLE connect_follow_ups DROP COLUMN personal");
    await trx.raw("DROP INDEX ix_connect_follow_ups_person");
  });
};

/** A person's first home: the one made for them, else the first home they're in. Null when they're in none. */
const FIRST_HOME = `coalesce(
  (SELECT w.id FROM workspaces w WHERE w.owner_user_id = a.user_id AND w.is_personal AND w.deleted_at IS NULL ORDER BY w.id LIMIT 1),
  (SELECT m.workspace_id FROM workspace_memberships m JOIN workspaces w ON w.id = m.workspace_id
    WHERE m.user_id = a.user_id AND m.status = 'active' AND w.deleted_at IS NULL ORDER BY m.workspace_id LIMIT 1)
)`;

/**
 * Each Google Drive account a home keeps its files in, or is moving them into, with that home: the first home by id when
 * two use the same one. Read through Settings → Files' sealed settings; a setting that doesn't open is left out.
 * @param {import('knex').Knex.Transaction} trx
 * @returns {Promise<Map<string, string>>}
 */
async function drivesInUse(trx) {
  const raw = String(process.env.MERCBOT_VAULT_KEY || "");
  const key = raw ? Buffer.from(raw, "base64") : null;
  const found = new Map();
  if (key?.length !== 32) return found;
  const { rows } = await trx.raw("SELECT workspace_id, kind, settings, move FROM file_storage ORDER BY workspace_id");
  for (const row of rows) {
    const places = [row.kind === "drive" ? { kind: "drive", ...opened(row.settings, key) } : null, opened(row.move?.target, key)];
    for (const place of places) {
      const accountId = place?.kind === "drive" ? String(place.accountId ?? "") : "";
      if (/^\d+$/u.test(accountId) && !found.has(accountId)) found.set(accountId, String(row.workspace_id));
    }
  }
  return found;
}

/** A sealed value opened as vaultCrypto.js's unseal opens it, or null when it isn't one or doesn't open under `key`. */
function opened(sealed, key) {
  if (!sealed?.iv || !sealed?.tag || !sealed?.data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(sealed.iv, "base64"));
    decipher.setAuthTag(Buffer.from(sealed.tag, "base64"));
    return JSON.parse(Buffer.concat([decipher.update(Buffer.from(sealed.data, "base64")), decipher.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

exports.contracts =
  "No one uses Mercbot before day 0, so this release moves people's own accounts to their homes, drops user_plugins, " +
  "connect_follow_ups.personal and ix_connect_follow_ups_person, and requires plugin_accounts.workspace_id in one step, " +
  "with no release before it left running (D-111). It can't be rolled back.";

exports.down = async function down() {
  throw new Error("Every account a home's (D-111) can't be rolled back: people's own accounts and their lists of apps are gone.");
};
