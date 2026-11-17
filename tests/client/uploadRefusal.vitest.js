import { ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadFile } from "../../src/components/mercbot/filesApi.js";
import { setCurrentHome } from "../../src/components/mercbot/homeApi.js";
import { useComposerFiles } from "../../src/components/mercbot/useComposerFiles.js";

// A file a copy built on Mercbot won't keep (D-90): the upload route's refusal reaches the chat's attachments and the
// file browser as an error in the server's own words ("This file can't be used."), with its code, and the chat
// doesn't attach the file. The routes are stand-ins.

const REFUSED = Object.freeze({ error: "This file can't be used.", code: "media_blocked" });

/** The session route and the upload route, the upload answering `status` with `body`. */
function answering(status, body) {
  const calls = [];
  vi.stubGlobal("fetch", vi.fn(async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    if (String(url).split("?")[0].endsWith("/upload")) return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({ csrfToken: "token" }), { status: 200, headers: { "content-type": "application/json" } });
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a refused upload", () => {
  it("throws the server's sentence and code, as the file browser shows it", async () => {
    setCurrentHome("home");
    const calls = answering(422, REFUSED);
    const failure = await uploadFile("4", new File(["x"], "cat.png", { type: "image/png" }), "/files/bot/Pictures").catch((error) => error);
    expect([failure.message, failure.status, failure.code]).toEqual(["This file can't be used.", 422, "media_blocked"]);
    expect(calls.at(-1)).toEqual({ url: "/api/w/home/bots/4/files/upload?folder=%2Ffiles%2Fbot%2FPictures", method: "POST" });
    answering(503, { error: "This file can't be checked right now. Try again in a few minutes.", code: "media_check_unavailable" });
    expect((await uploadFile("4", new File(["x"], "cat.png")).catch((error) => error)).message).toBe(
      "This file can't be checked right now. Try again in a few minutes."
    );
  });

  it("isn't attached in the chat, which reports the server's sentence", async () => {
    setCurrentHome("home");
    answering(422, REFUSED);
    const attachments = ref([]);
    const failures = [];
    const { addFiles } = useComposerFiles({ attachments, ownChat: () => ({ id: "4" }), focusComposer: () => {}, onFailure: (error) => failures.push(error.message) });
    await addFiles({ target: { files: [new File(["x"], "cat.png", { type: "image/png" })], value: "C:\\fakepath\\cat.png" } });
    expect(failures).toEqual(["This file can't be used."]);
    expect(attachments.value).toEqual([]);
  });
});
