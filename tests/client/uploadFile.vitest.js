import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadFile } from "../../src/components/apps/uploadFile.js";

// A file going up (a record's file field, a public form's): sent as a form with the session's CSRF token, through
// XMLHttpRequest, which tells how much has gone (fetch can't), so the field shows its percentage.
class FakeUpload {
  static last = null;
  static answer = { status: 200, text: JSON.stringify({ record: { id: "7" } }) };
  static lost = false;
  constructor() {
    this.upload = {};
    this.headers = {};
    FakeUpload.last = this;
  }
  open(method, address) {
    Object.assign(this, { method, address });
  }
  setRequestHeader(name, value) {
    this.headers[name] = value;
  }
  send(body) {
    this.body = body;
    if (FakeUpload.lost) return this.onerror();
    for (const loaded of [250, 1000]) this.upload.onprogress({ lengthComputable: true, loaded, total: 1000 });
    Object.assign(this, { status: FakeUpload.answer.status, responseText: FakeUpload.answer.text });
    this.onload();
  }
}

const file = new File(["hello"], "book.txt", { type: "text/plain" });
function stubBrowser() {
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({ csrfToken: "t0ken" }) })));
  vi.stubGlobal("XMLHttpRequest", FakeUpload);
}
afterEach(() => {
  vi.unstubAllGlobals();
  FakeUpload.answer = { status: 200, text: JSON.stringify({ record: { id: "7" } }) };
  FakeUpload.lost = false;
});

describe("a file going up", () => {
  it("tells how much has gone, in percent, and answers the server's reply", async () => {
    stubBrowser();
    const heard = [];
    const reply = await uploadFile("/api/w/home/app-data/files", file, { onProgress: (percent) => heard.push(percent) });
    expect(heard).toEqual([25, 100]);
    expect(reply).toEqual({ record: { id: "7" } });
    const sent = FakeUpload.last;
    expect([sent.method, sent.address, sent.withCredentials, sent.headers["csrf-token"]]).toEqual(["POST", "/api/w/home/app-data/files", true, "t0ken"]);
    expect(sent.body.get("file").name).toBe("book.txt");
  });

  it("is refused with the server's words, or plain ones for a size limit met on the way and a lost connection", async () => {
    stubBrowser();
    FakeUpload.answer = { status: 400, text: JSON.stringify({ error: "Only a picture goes there." }) };
    await expect(uploadFile("/x", file)).rejects.toMatchObject({ message: "Only a picture goes there.", status: 400 });
    FakeUpload.answer = { status: 413, text: "" };
    await expect(uploadFile("/x", file, { tooBig: "Too big (10 MB at most)." })).rejects.toMatchObject({ message: "Too big (10 MB at most).", status: 413 });
    FakeUpload.lost = true;
    await expect(uploadFile("/x", file)).rejects.toThrow("That file didn't upload: the connection was lost. Check it and try again.");
  });
});
