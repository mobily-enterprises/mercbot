import { afterEach, describe, expect, it, vi } from "vitest";
import { appsApi, errorText } from "../../src/components/apps/appsApi.js";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";

// A record's file or picture going up (D-130): the server's refusal comes back in its own words with its code, and a
// connection that drops says so in plain words, never the browser's own error. The session's token is read with fetch;
// the file goes up through XMLHttpRequest (uploadFile.js), stood in for here: `reply(address)` is the server's answer,
// { status, text }, or null for a connection that drops.
const answer = (status, body) => ({ ok: status < 400, status, json: async () => body });
const sent = [];
function stubBrowser(reply) {
  vi.stubGlobal("fetch", async () => answer(200, { csrfToken: "t" }));
  vi.stubGlobal("XMLHttpRequest", class {
    constructor() {
      this.upload = {};
    }
    open(method, address) {
      Object.assign(this, { method, address });
    }
    setRequestHeader() {}
    send() {
      sent.push([this.address, this.method]);
      const answered = reply(this.address);
      if (!answered) return this.onerror();
      Object.assign(this, { status: answered.status, responseText: answered.text });
      this.onload();
    }
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  sent.length = 0;
});

describe("a record's file upload", () => {
  it("posts the file to the record's field, in the current home, and answers the record", async () => {
    setCurrentHome("rossi");
    stubBrowser(() => ({ status: 200, text: JSON.stringify({ record: { id: "5" } }) }));
    expect(await appsApi.attachFile("graphics", "5", "picture", new File(["x"], "p.png"))).toEqual({ id: "5" });
    expect(sent.at(-1)).toEqual(["/api/w/rossi/app-data/tables/graphics/records/5/files/picture", "POST"]);
  });

  it("refused, carries the server's words and code", async () => {
    stubBrowser(() => ({ status: 413, text: JSON.stringify({ error: "That file is too big to add; the limit is 25 MB.", code: "apps_file_too_big" }) }));
    const refused = await appsApi.attachFile("graphics", "5", "picture", new File(["x"], "p.png")).catch((error) => error);
    expect([refused.status, refused.data.code, errorText(refused, "")]).toEqual([413, "apps_file_too_big", "That file is too big to add; the limit is 25 MB."]);
  });

  it("stopped for its size before it reached Mercbot, with no words of the server's, says it's too big", async () => {
    stubBrowser(() => ({ status: 413, text: "<html>Request Entity Too Large</html>" }));
    const refused = await appsApi.attachFile("graphics", "5", "picture", new File(["x"], "p.png")).catch((error) => error);
    expect(errorText(refused, "")).toBe("That file is too big to add.");
  });

  it("with the connection gone, says so in plain words", async () => {
    stubBrowser(() => null);
    const failed = await appsApi.attachFile("graphics", "5", "picture", new File(["x"], "p.png")).catch((error) => error);
    expect(errorText(failed, "")).toBe("That file didn't upload: the connection was lost. Check it and try again.");
  });
});
