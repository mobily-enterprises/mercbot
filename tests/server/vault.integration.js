import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import test from "node:test";
import knex from "knex";
import { createKnexMigrationConfigFromApp } from "@jskit-ai/database-runtime/server/knexMigrationConfig";
import { createServer } from "../../server.js";
import { PICTURE, browser } from "../support/browser.mjs";

// The Vault's Import from a CSV file and Read a photo routes on the real server (D-17):
// an import is checked, sealed and saved whole or not at all, and a photo goes to Gemini (a
// stand-in here) only when it's a picture. The server reads its database as it starts, so this
// file runs in the database suite, on its own copy of the test template.
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must be this file's own test database copy: run it with npm run test:database.");

const runtimeEnv = {
  ...process.env,
  AUTH_LOCAL_SESSION_SECRET: "vault-test-only-secret",
  AUTH_LOCAL_EMAIL_CONFIRMATION: "false",
  DB_CLIENT: "pg",
  HOST: "127.0.0.1",
  NODE_ENV: "test",
  PORT: "3001",
  SERVER_SURFACE: "all",
  MERCBOT_VAULT_KEY: randomBytes(32).toString("base64"),
  AI_IMAGES_PROVIDER: "gemini",
  AI_IMAGES_API_KEY: "test-key"
};

async function signedIn(app, email = `vault-${randomUUID()}@example.test`) {
  const request = browser(app);
  assert.equal((await request("GET", "/api/session")).status, 200);
  const signedUp = await request("POST", "/api/register", { json: { email, password: "Vault-test-password-2026!" } });
  assert.equal(signedUp.status, 201, JSON.stringify(signedUp.body));
  return request;
}

test("the Vault imports a file's items whole or not at all, sealed, and reads contact details from a photo", async (t) => {
  const database = knex(await createKnexMigrationConfigFromApp({ client: "pg", environment: runtimeEnv }));
  t.after(() => database.destroy());
  const app = await createServer({ runtimeEnv });
  t.after(() => app.close());
  const email = `vault-${randomUUID()}@example.test`;
  const request = await signedIn(app, email);
  const items = async () => (await request("GET", "/api/vault")).body.items;
  // A photo is read in a home, which pays for it (D-73): here the person's own.
  const home = await database("workspaces")
    .join("users", "users.id", "workspaces.owner_user_id")
    .where({ "users.email": email, "workspaces.is_personal": true })
    .first("workspaces.id", "workspaces.slug");
  const readPhoto = `/api/w/${home.slug}/vault/read-photo`;

  // A refused row refuses the batch, and says which row of the file it was.
  const refused = await request("POST", "/api/vault/import", {
    json: {
      kind: "login",
      items: [
        { row: 2, data: { website: "first.example", username: "me", password: "First-secret-1" } },
        { row: 3, data: { website: "second.example", username: "me" } }
      ]
    }
  });
  assert.equal(refused.status, 400, JSON.stringify(refused.body));
  assert.deepEqual(refused.body, { error: "Row 3: A login needs a website and a password.", code: "account_vault_login_incomplete", params: { row: 3 } });
  assert.deepEqual(await items(), [], "nothing was saved");

  const tooMany = await request("POST", "/api/vault/import", {
    json: { kind: "contact", items: Array.from({ length: 101 }, (_, index) => ({ row: index + 2, data: { fullName: `Person ${index}` } })) }
  });
  assert.equal(tooMany.status, 400);
  assert.equal(tooMany.body.code, "account_vault_import_size");

  const logins = await request("POST", "/api/vault/import", {
    json: {
      kind: "login",
      items: [
        { row: 2, data: { website: "first.example", username: "me", password: " First-secret-1 " } },
        { row: 3, data: { website: "second.example", username: "you", password: "Second-secret-2", notes: "Private note" } }
      ]
    }
  });
  assert.equal(logins.status, 200, JSON.stringify(logins.body));
  assert.deepEqual(logins.body.items.map((item) => [item.kind, item.label, item.data]), [
    ["login", "first.example", { website: "first.example", username: "me" }],
    ["login", "second.example", { website: "second.example", username: "you" }]
  ]);
  const cards = await request("POST", "/api/vault/import", {
    json: { kind: "card", items: [{ row: 2, data: { number: "4242 4242 4242 4242", expiry: "07/28", code: "123", name: "A Person" } }] }
  });
  assert.equal(cards.status, 200, JSON.stringify(cards.body));
  assert.equal(cards.body.items[0].label, "Visa •••• 4242");
  assert.equal((await items()).length, 3);

  // Passwords, notes and card numbers are sealed in the database, and never in an answer.
  const answers = JSON.stringify([logins.body, cards.body, await items()]);
  const stored = JSON.stringify(await database("vault_items").whereIn("id", (await items()).map((item) => item.id)).select("label", "data"));
  for (const secret of ["First-secret-1", "Second-secret-2", "Private note", "4242424242424242", "4242 4242 4242 4242"]) {
    assert.ok(!answers.includes(secret), `${secret} isn't in an answer`);
    assert.ok(!stored.includes(secret), `${secret} is sealed in the database`);
  }

  // Reading a photo: the picture goes to Gemini once, and what it read comes back to fill the form.
  const sent = [];
  let failNext = false;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) return realFetch(url, options);
    sent.push(JSON.parse(options.body));
    if (failNext) {
      failNext = false;
      return new Response(JSON.stringify({ error: { message: "Internal error" } }), { status: 500 });
    }
    const text = JSON.stringify({ fullName: "Ada Lovelace", email: "ada@example.com" });
    const usageMetadata = { promptTokenCount: 300, candidatesTokenCount: 20 };
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }], usageMetadata }), { status: 200 });
  };
  t.after(() => {
    globalThis.fetch = realFetch;
  });
  const notPicture = await request("POST", readPhoto, { upload: ["photo", "photo.jpg", "image/jpeg", Buffer.from("plain text, not a picture")] });
  assert.equal(notPicture.status, 400, JSON.stringify(notPicture.body));
  assert.equal(notPicture.body.code, "account_vault_photo_type");
  assert.equal(sent.length, 0);
  const read = await request("POST", readPhoto, { upload: ["photo", "photo.png", "image/png", PICTURE] });
  assert.equal(read.status, 200, JSON.stringify(read.body));
  assert.deepEqual(read.body, { fields: { fullName: "Ada Lovelace", email: "ada@example.com" } });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].contents[0].parts[0].inlineData, { mimeType: "image/png", data: PICTURE.toString("base64") });
  assert.equal((await items()).length, 3, "reading a photo saves nothing");
  // It's recorded for the home with what it cost, like any AI call (D-73): Gemini's figures, 300 tokens in and 20 out,
  // at its reading model's list prices ($0.75 and $3.75 a million): $0.0003.
  const recorded = () => database("usage_daily").where({ workspace_id: home.id, kind: "images" }).first().sum({ images: "images", cost: "cost_nano", calls: "calls" });
  assert.deepEqual(await recorded(), { images: "0", cost: "300000", calls: "1" });

  // A failure of the images AI is the person's AI work. With no feature keeping the providers' failures
  // (mercbot.provider-failures), it's a line in the server log, which the reader writes in the background.
  const logged = [];
  const warn = console.warn;
  console.warn = (...args) => {
    logged.push(args.join(" "));
    warn(...args);
  };
  t.after(() => {
    console.warn = warn;
  });
  failNext = true;
  const failed = await request("POST", readPhoto, { upload: ["photo", "photo.png", "image/png", PICTURE] });
  assert.equal(failed.status, 502, JSON.stringify(failed.body));
  assert.equal(failed.body.code, "account_vault_photo_failed");
  const line = "The images AI's provider gemini failed with 500: Internal error";
  for (let tries = 0; !logged.includes(line) && tries < 50; tries += 1) await new Promise((resolve) => setTimeout(resolve, 100));
  assert.ok(logged.includes(line), "the failure is in the server log");
  assert.deepEqual(await recorded(), { images: "0", cost: "300000", calls: "2" }, "a failed read is recorded, at no cost");

  // Someone else sees none of it, and someone signed out can't call either route.
  assert.deepEqual(await (await signedIn(app))("GET", "/api/vault").then((answer) => answer.body.items), []);
  const stranger = browser(app);
  await stranger("GET", "/api/session");
  assert.equal((await stranger("POST", "/api/vault/import", { json: { kind: "contact", items: [{ data: { fullName: "X" } }] } })).status, 401);
  assert.equal((await stranger("POST", readPhoto, { upload: ["photo", "photo.png", "image/png", PICTURE] })).status, 401);
});
