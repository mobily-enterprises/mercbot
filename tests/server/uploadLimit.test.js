import assert from "node:assert/strict";
import test from "node:test";
import { UPLOAD_LIMIT, tooBig } from "../../packages/files/src/server/uploadedFile.js";

// What a person uploads (a chat's attachment, a file in the file browser, a file or picture on an app's record) is up to
// 150 MB, and one past it is refused saying so.
test("uploads take up to 150 MB, and one past it is refused naming the limit", () => {
  assert.equal(UPLOAD_LIMIT, 150 * 1024 * 1024);
  const refused = tooBig();
  assert.deepEqual([refused.status ?? refused.statusCode, refused.message, refused.params?.limitMb ?? refused.details?.params?.limitMb], [413, "That file is too big; the limit is 150 MB.", 150]);
});
