import assert from "node:assert/strict";
import test from "node:test";
import { missingKeyLines } from "../../packages/account/src/server/keys.js";

// A server's start names each missing setting its own role uses, and only those (D-131): a computers server runs bots'
// computers for the other servers, so it needs the premium AI their browser steps run on, the Vault key that seals
// their saved browsers and the files bucket their files go to, and nothing of what pages, bots' work or connected apps
// need. The role is the server's (server.js sets MERCBOT_SERVER_ROLE from it).
test("a computers server's start names only the settings it uses, each saying what's off on it", () => {
  const lines = missingKeyLines({ MERCBOT_SERVER_ROLE: "computers" });
  assert.deepEqual(lines.map((line) => line.split(" ")[0]), [
    "AI_PREMIUM_PROVIDER", "AI_PREMIUM_API_KEY", "MERCBOT_VAULT_KEY", "MERCBOT_FILES_S3_BUCKET", "MERCBOT_FILES_S3_REGION",
    "MERCBOT_FILES_S3_ACCESS_KEY_ID", "MERCBOT_FILES_S3_SECRET_ACCESS_KEY", "MERCBOT_FILES_PASSPHRASE"
  ]);
  assert.equal(lines[0], "AI_PREMIUM_PROVIDER isn't set, so this is off: Premium AI. The bots' browser steps on this server's computers can't run.");
  assert.equal(
    lines.find((line) => line.startsWith("MERCBOT_VAULT_KEY ")),
    "MERCBOT_VAULT_KEY isn't set, so this is off: Vault key. Bots' browser sign-ins on this server's computers don't outlive their machine."
  );
  assert.equal(
    lines.find((line) => line.startsWith("MERCBOT_FILES_PASSPHRASE ")),
    "MERCBOT_FILES_PASSPHRASE isn't set, so this is off: Bots' file storage. Its computers' files stay in a folder on this machine, where no other server finds them."
  );
  // Given all three, it names none.
  assert.deepEqual(missingKeyLines({
    MERCBOT_SERVER_ROLE: "computers",
    AI_PREMIUM_PROVIDER: "together",
    AI_PREMIUM_API_KEY: "set",
    MERCBOT_VAULT_KEY: "set",
    MERCBOT_FILES_S3_BUCKET: "set",
    MERCBOT_FILES_S3_REGION: "set",
    MERCBOT_FILES_S3_ACCESS_KEY_ID: "set",
    MERCBOT_FILES_S3_SECRET_ACCESS_KEY: "set",
    MERCBOT_FILES_PASSPHRASE: "set"
  }), []);
});

test("a web server's start names every missing setting, as a copy's always has", () => {
  assert.deepEqual(missingKeyLines({ MERCBOT_SERVER_ROLE: "web" }), missingKeyLines({}));
});

test("a role there isn't stops the report, naming the roles there are", () => {
  assert.throws(() => missingKeyLines({ MERCBOT_SERVER_ROLE: "worker" }), /^Error: A Mercbot server needs its role: "web" .+ or "computers" /u);
});
