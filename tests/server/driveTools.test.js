import assert from "node:assert/strict";
import test from "node:test";
import * as google from "../../packages/bots/src/server/googleApps.js";
import * as microsoft from "../../packages/bots/src/server/microsoftApps.js";
import { DRIVE_ACTIONS, buildDriveTools } from "../../packages/bots/src/server/driveTools.js";

// The rest of the person's drive (D-42), against stand-ins for Drive's and Graph's APIs.
function fakeApi(context, routes) {
  const calls = [];
  const original = globalThis.fetch;
  // Query strings as written: "+" is a space there.
  const plain = (url) => decodeURIComponent(String(url).replace(/\+/gu, " "));
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: plain(url), method: options.method || "GET", body: typeof options.body === "string" ? options.body : null });
    const match = Object.entries(routes).find(([pattern]) => {
      const [method, part] = /^(GET|POST|PUT|PATCH|DELETE) /u.test(pattern) ? [pattern.split(" ")[0], pattern.slice(pattern.indexOf(" ") + 1)] : ["", pattern];
      return (!method || method === (options.method || "GET")) && plain(url).includes(part);
    });
    const [status, body] = match ? match[1] : [404, { error: { message: "not found" } }];
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  context.after(() => { globalThis.fetch = original; });
  return calls;
}

test("Drive: search looks in names and contents, a folder is found by name, and a Doc reads as text", async (context) => {
  const calls = fakeApi(context, {
    "name = 'Projects'": [200, { files: [{ id: "F1", name: "Projects", mimeType: "application/vnd.google-apps.folder" }] }],
    "'F1' in parents": [200, { files: [{ id: "d1", name: "Plan", mimeType: "application/vnd.google-apps.document" }] }],
    "fullText contains": [200, { files: [{ id: "d1", name: "Plan", mimeType: "application/vnd.google-apps.document" }] }],
    "/files/d1/export": [200, "The plan, in words."],
    "/files/d1?fields=id,name,mimeType": [200, { id: "d1", name: "Plan", mimeType: "application/vnd.google-apps.document" }]
  });
  assert.deepEqual((await google.searchFiles("k", "Kim's plan")).map((file) => file.kind), ["a Google Doc"]);
  assert.match(calls[0].url, /name contains 'Kim\\'s plan' or fullText contains 'Kim\\'s plan'/u);
  assert.deepEqual((await google.listFolder("k", "Projects")).map((file) => file.name), ["Plan"]);
  assert.deepEqual(await google.readFileText("k", "d1"), { name: "Plan", text: "The plan, in words." });
  assert.match(calls.at(-1).url, /export\?mimeType=text\/plain/u);
});

test("Drive: a Doc exports to the format asked, sharing names the role, moving swaps the folder", async (context) => {
  const calls = fakeApi(context, {
    "PATCH /files/d1?": [200, { id: "d1", name: "Plan 2026", mimeType: "application/vnd.google-apps.document" }],
    "/files/d1?fields=id,name,mimeType,size": [200, { id: "d1", name: "Plan", mimeType: "application/vnd.google-apps.document", permissions: [{ role: "owner", emailAddress: "pat@example.com" }, { role: "commenter", emailAddress: "kim@example.com", type: "user" }] }],
    "/files/d1?fields=id,name,mimeType": [200, { id: "d1", name: "Plan", mimeType: "application/vnd.google-apps.document" }],
    "/files/d1/export": [200, "%PDF-1.4"],
    "POST /files/d1/permissions": [200, { id: "p1" }],
    "name = 'Archive'": [200, { files: [{ id: "F9", name: "Archive" }] }],
    "/files/d1?fields=parents": [200, { parents: ["root"] }]
  });
  const pdf = await google.downloadFile("k", "d1", "pdf");
  assert.deepEqual([pdf.name, pdf.data.toString()], ["Plan.pdf", "%PDF-1.4"]);
  await assert.rejects(google.downloadFile("k", "d1", "xlsx"), /can be exported as pdf, docx, html, txt/u);
  const shared = await google.shareFile("k", "d1", { email: "kim@example.com", role: "comment", notify: false });
  assert.deepEqual(JSON.parse(calls.find((call) => call.url.includes("/permissions")).body), { type: "user", role: "commenter", emailAddress: "kim@example.com" });
  assert.match(calls.find((call) => call.url.includes("/permissions")).url, /sendNotificationEmail=false/u);
  assert.deepEqual(shared.sharedWith, [{ who: "kim@example.com", role: "commenter" }]);
  const moved = await google.moveFile("k", "d1", { folder: "Archive", name: "Plan 2026" });
  assert.equal(moved.name, "Plan 2026");
  assert.match(calls.at(-1).url, /addParents=F9&removeParents=root/u);
});

test("OneDrive: a folder by path, a file made from text, a PDF conversion, and no comments", async (context) => {
  const calls = fakeApi(context, {
    "/drive/root:/Projects/2026:/children": [200, { value: [{ id: "A1", name: "notes.txt", size: 12 }] }],
    "PUT /drive/root:/Projects/list.csv:/content": [200, { id: "A2", name: "list.csv", webUrl: "https://onedrive/a2" }],
    "/drive/items/A3/content?format=pdf": [200, "%PDF"],
    "/drive/items/A3": [200, { id: "A3", name: "Report.docx" }]
  });
  assert.deepEqual((await microsoft.listFolder("k", "Projects/2026")).map((item) => item.name), ["notes.txt"]);
  assert.equal((await microsoft.createFile("k", { name: "list.csv", text: "a,b", folder: "Projects" })).link, "https://onedrive/a2");
  assert.equal(calls.at(-1).body, "a,b");
  assert.equal((await microsoft.downloadFile("k", "A3", "pdf")).name, "Report.pdf");
  await assert.rejects(microsoft.downloadFile("k", "A3", "xlsx"), /only to PDF/u);
  await assert.rejects(microsoft.listComments("k", "A3"), /this is for Google Drive/u);
});

test("each drive action is its own switch, and sharing or commenting asks unless the person asked for it", () => {
  const shared = { attempt: async () => ({}), attempted: [], failed: (error) => ({ error: error.message }), account: () => undefined, pickDrive: async () => ({}), inTime: (work) => work };
  const all = buildDriveTools({ ...shared, removed: [], keep: async () => "/files/mine/Drive/x" });
  assert.deepEqual(Object.keys(all), ["driveFind", "driveRead", "driveChange", "driveComments"]);
  assert.deepEqual(all.driveRead.inputSchema.shape.action.options, ["read", "download", "export"]);
  const noFiles = buildDriveTools({ ...shared, removed: ["drive_change.share", "drive_comments.list", "drive_comments.add", "drive_comments.reply"], keep: async () => "/files/mine/Drive/x" });
  assert.equal(noFiles.driveChange.inputSchema.shape.action.options.includes("share"), false);
  assert.equal(noFiles.driveComments, undefined);
  assert.equal(DRIVE_ACTIONS["drive_change.share"].reversible({ personAsked: false }), false);
  assert.equal(DRIVE_ACTIONS["drive_change.move"].reversible({}), true);
  assert.equal(DRIVE_ACTIONS["drive_comments.add"].reversible({ personAsked: true }), true);
});
