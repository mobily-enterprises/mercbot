/**
 * Which files key each files bucket keeps (D-91, packages/files/src/server/filesVolume.js): the first server to find a
 * new bucket without its key record writes the record it made here, and every server, of those starting together too,
 * then uses the one row kept, so they all seal with one key on any store speaking the S3 API, whether or not it takes
 * conditional writes (some stores answer them 501). `bucket` names the bucket by a digest of its endpoint,
 * name and prefix; `record` is the files key sealed with MERCBOT_FILES_PASSPHRASE, as the bucket's `.mercbot-files`
 * holds it, which only the passphrase opens.
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw(`
    CREATE TABLE files_keys (
      bucket character varying(64) PRIMARY KEY,
      record text NOT NULL,
      created_at timestamp with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
    )
  `);
};

exports.down = async function down(knex) {
  await knex.raw("DROP TABLE IF EXISTS files_keys");
};
