import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";
import { registerRoutes } from "../../packages/apps/src/server/registerRoutes.js";

// A record's file or picture uploaded through its route (D-130): one past the files' size limit is refused before the
// record changes, saying what the limit is, as the file browser's own upload says it.
function uploadRoute({ truncated }) {
  const handlers = new Map();
  const attached = [];
  const appsRuntime = {
    recordUploads: () => ({ limit: 25 * 1024 * 1024, receive: async (stream) => { for await (const chunk of stream) void chunk; } }),
    gate: { attachFile: async (...args) => attached.push(args) && { id: "5" } }
  };
  const uploads = {
    readSingleMultipartFile: async () => {
      const stream = Readable.from([Buffer.from("bytes")]);
      stream.truncated = truncated;
      return { fileName: "huge.mov", mimeType: "video/quicktime", stream };
    }
  };
  registerRoutes({ router: { register: (method, path, _options, handler) => handlers.set(`${method} ${path}`, handler) } }, { appsRuntime, notices: {}, streams: new Set(), uploads });
  async function call() {
    const answered = {};
    const reply = { code(status) { answered.status = status; return reply; }, send(sent) { answered.body = sent; return reply; } };
    const request = { workspace: { id: "3", slug: "home-3" }, user: { id: "2", displayName: "Ben" }, permissions: [], params: { key: "graphics", id: "5", field: "source" }, callOptions: async () => ({}) };
    await handlers.get("POST /api/w/:workspaceSlug/app-data/tables/:key/records/:id/files/:field")(request, reply);
    return answered;
  }
  return { call, attached };
}

test("a file past the size limit is refused, naming the limit, and the record isn't changed", async () => {
  const { call, attached } = uploadRoute({ truncated: true });
  const refused = await call();
  assert.deepEqual(refused, { status: 413, body: { error: "That file is too big to add; the limit is 25 MB.", code: "apps_file_too_big", params: { limitMb: 25 } } });
  assert.deepEqual(attached, []);
});

test("a file within the limit goes onto the record", async () => {
  const { call, attached } = uploadRoute({ truncated: false });
  const answered = await call();
  assert.equal(answered.status, 200);
  assert.equal(attached.length, 1);
});
