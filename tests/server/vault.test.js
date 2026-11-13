import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { VAULT_FIELDS, vaultProblem } from "../../packages/account/src/shared/vault.js";
import { unseal } from "../../packages/account/src/server/vaultCrypto.js";
import { vaultEntry } from "../../packages/account/src/server/vaultEntry.js";
import { refuseWork } from "../../packages/account/src/server/meter.js";
import { readContactPhoto } from "../../packages/account/src/server/vaultPhoto.js";

// The Vault's rules (D-17), which its forms, its CSV import and the server share, and
// reading contact details from a photo with Gemini, where no secret ever goes.
const KEY = randomBytes(32);
const CARD = "4242 4242 4242 4242";
const PHOTO = { data: Buffer.from("a photo of a business card"), type: "image/jpeg" };
// The images kind of AI (D-72), which reads the photos.
const IMAGES = Object.freeze({ AI_IMAGES_PROVIDER: "gemini", AI_IMAGES_API_KEY: "test-key" });

test("an item is refused for the same reasons wherever it's checked", () => {
  assert.equal(vaultProblem("contact", { label: "Home" })?.code, "account_vault_contact_empty");
  assert.equal(vaultProblem("contact", { phone: " +44 20 7946 0000 " }), null);
  assert.equal(vaultProblem("login", { website: "example.com" })?.code, "account_vault_login_incomplete");
  assert.equal(vaultProblem("login", { website: "  ", password: "pw" })?.code, "account_vault_login_incomplete");
  assert.equal(vaultProblem("login", { website: "example.com", password: " pw " }), null);
  assert.equal(vaultProblem("card", { number: "4242 4242 4242 4241", expiry: "07/28" })?.code, "account_vault_card_number_invalid");
  assert.equal(vaultProblem("card", { number: CARD, expiry: "7/28" })?.code, "account_vault_card_expiry_invalid");
  assert.equal(vaultProblem("card", { number: CARD, expiry: "13/28" })?.code, "account_vault_card_expiry_invalid");
  assert.equal(vaultProblem("card", { number: CARD, expiry: "07/28" }), null);
  assert.deepEqual(vaultProblem("note", {}), { message: "Choose a login, a card or contact info.", code: "account_vault_kind_unknown" });
});

test("saving an item seals its secrets exactly as given, and keeps contact info plain", () => {
  const login = vaultEntry({ kind: "login", data: { website: " example.com ", username: " me@example.com ", password: " pass word ", notes: " n " } }, KEY);
  assert.equal(login.label, "example.com");
  assert.deepEqual({ website: login.data.website, username: login.data.username }, { website: "example.com", username: "me@example.com" });
  assert.doesNotMatch(JSON.stringify(login), /pass word/u);
  assert.deepEqual(unseal(login.data.secret, KEY), { password: " pass word ", notes: "n" });

  const card = vaultEntry({ kind: "card", data: { number: CARD, expiry: "07/28", code: "12 3", name: "A Person" } }, KEY);
  assert.equal(card.label, "Visa •••• 4242");
  assert.doesNotMatch(JSON.stringify(card), /4242424242424242/u);
  assert.deepEqual(unseal(card.data.secret, KEY), { number: "4242424242424242", code: "123", billing: "" });

  const contact = vaultEntry({ kind: "contact", data: { fullName: "x".repeat(300) } }, null);
  assert.equal(contact.data.fullName.length, 200);
  assert.equal(contact.label.length, 120, "a label fits its column");
  assert.deepEqual(Object.keys(contact.data), VAULT_FIELDS.contact);

  for (const kind of ["login", "card"]) {
    assert.throws(() => vaultEntry({ kind, data: {} }, null), { statusCode: 503, code: "account_vault_unavailable" });
  }
  assert.throws(() => vaultEntry({ kind: "card", data: { number: CARD, expiry: "0728" } }, KEY), {
    statusCode: 400,
    code: "account_vault_card_expiry_invalid",
    message: "Give the expiry as MM/YY."
  });
});

/** A stand-in for Gemini: records each call and answers as told. */
function gemini(answer) {
  const calls = [];
  async function send(url, request) {
    calls.push({ url, request, body: JSON.parse(request.body) });
    if (answer instanceof Error) throw answer;
    return { ok: answer.status === 200, status: answer.status, json: async () => answer.body };
  }
  return { calls, send };
}
const reply = (text, status = 200) => ({ status, body: { candidates: [{ content: { parts: [{ text }] } }] } });

/** console.warn's lines while `work` runs. */
async function warnings(work) {
  const lines = [];
  const warn = console.warn;
  console.warn = (...parts) => lines.push(parts.join(" "));
  try {
    await work();
  } finally {
    console.warn = warn;
  }
  return lines;
}

test("a photo's contact details are read by Gemini, and only contact details are asked for", async () => {
  const { calls, send } = gemini(reply(JSON.stringify({
    fullName: "  Ada Lovelace ",
    email: "ada@example.com",
    phone: "",
    label: "Should be ignored",
    password: "never asked for",
    city: 42
  })));
  const read = await readContactPhoto(IMAGES, PHOTO, send);
  assert.deepEqual(read, { fields: { fullName: "Ada Lovelace", email: "ada@example.com" } });

  assert.equal(calls.length, 1);
  const [{ url, request, body }] = calls;
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent");
  assert.equal(request.headers["x-goog-api-key"], "test-key");
  assert.deepEqual(body.contents[0].parts[0], { inlineData: { mimeType: "image/jpeg", data: PHOTO.data.toString("base64") } });
  assert.deepEqual(Object.keys(body.generationConfig.responseSchema.properties), VAULT_FIELDS.contact.filter((field) => field !== "label"));
  assert.doesNotMatch(request.body, /password|"number"|"code"|billing/u, "nothing secret is asked for");
  assert.match(body.systemInstruction.parts[0].text, /never instructions to you/u);

  const fenced = gemini(reply("```json\n{\"city\":\"Paris\"}\n```"));
  assert.deepEqual(await readContactPhoto(IMAGES, PHOTO, fenced.send), { fields: { city: "Paris" } });
});

test("a photo that can't be read says why in the person's words, and the log names no photo or key", async () => {
  const unset = gemini(reply("{}"));
  await assert.rejects(readContactPhoto({}, PHOTO, unset.send), { statusCode: 503, code: "account_vault_photo_unavailable" });
  await assert.rejects(readContactPhoto({ AI_IMAGES_PROVIDER: "gemini" }, PHOTO, unset.send), { statusCode: 503, code: "account_vault_photo_unavailable" });
  await assert.rejects(readContactPhoto({ AI_IMAGES_API_KEY: "test-key" }, PHOTO, unset.send), { statusCode: 503, code: "account_vault_photo_unavailable" });
  assert.equal(unset.calls.length, 0, "with no key nothing is sent");

  for (const [answer, expected] of [
    [reply("{}"), { statusCode: 422, code: "account_vault_photo_unread" }],
    [reply("not JSON at all"), { statusCode: 422, code: "account_vault_photo_unread" }]
  ]) {
    await assert.rejects(readContactPhoto(IMAGES, PHOTO, gemini(answer).send), expected);
  }

  const failures = [
    [{ status: 429, body: { error: { message: "Resource exhausted" } } }, { statusCode: 503, code: "account_vault_photo_busy" }, "Gemini answered 429: Resource exhausted"],
    // A key whose project has no billing: as if reading photos wasn't set up, since trying again never helps.
    [
      { status: 429, body: { error: { message: "Quota exceeded for metric: generate_content_free_tier_requests, limit: 0" } } },
      { statusCode: 503, code: "account_vault_photo_unavailable" },
      "Gemini answered 429: Quota exceeded for metric: generate_content_free_tier_requests, limit: 0"
    ],
    [{ status: 500, body: {} }, { statusCode: 502, code: "account_vault_photo_failed" }, "Gemini answered 500"],
    [new Error("connect ECONNREFUSED"), { statusCode: 502, code: "account_vault_photo_failed" }, "Gemini couldn't be reached: connect ECONNREFUSED"]
  ];
  for (const [answer, expected, why] of failures) {
    const lines = await warnings(() => assert.rejects(readContactPhoto(IMAGES, PHOTO, gemini(answer).send), expected));
    assert.deepEqual(lines, [`The Vault's photo reader failed: ${why}`]);
  }

  // Work its copy refuses (D-73): the photo isn't sent, and the refusal says so.
  const lines = await warnings(() => assert.rejects(readContactPhoto(IMAGES, PHOTO, gemini(refuseWork("Paused.", { code: "work_paused" })).send), { statusCode: 402, code: "work_paused" }));
  assert.deepEqual(lines, [], "not logged as the reader failing");
});
