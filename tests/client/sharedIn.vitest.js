import { describe, expect, it, vi } from "vitest";
import { readShare, waitForChat } from "../../src/components/mercbot/sharedIn.js";

// What another app shares into the installed app (D-133): kept by the service worker under a key until a chat is
// chosen, read once, and put in that chat's message box, never another's.
function storage(entries) {
  const kept = new Map(Object.entries(entries));
  const cache = {
    match: async (url) => (kept.has(url) ? new Response(kept.get(url)) : undefined),
    keys: async () => [...kept.keys()].map((url) => ({ url: `https://m.test${url}` })),
    delete: async (request) => kept.delete(new URL(request.url).pathname)
  };
  return { open: async () => cache, kept };
}

describe("reading a share", () => {
  it("reads its words once, each said once, with its files, and forgets it", async () => {
    const caches = storage({
      "/shared/abc1/meta": JSON.stringify({ title: "Dinner", text: "Try https://e.test/r", url: "https://e.test/r", files: [{ name: "a.txt", type: "text/plain" }] }),
      "/shared/abc1/0": "oak"
    });
    const share = await readShare("abc1", caches);
    expect(share.text).toBe("Dinner\nTry https://e.test/r");
    expect(share.files.map((file) => file.name)).toEqual(["a.txt"]);
    expect(caches.kept.size).toBe(0);
  });

  it("says when it's gone (kept an hour, or opened already) or when the browser keeps none", async () => {
    await expect(readShare("abc1", storage({}))).resolves.toEqual({ gone: true });
    await expect(readShare("abc1", undefined)).resolves.toEqual({ gone: true });
  });
});

describe("waiting for the chosen chat", () => {
  it("answers true once it's open, and false if it never opens, so nothing lands in another chat", async () => {
    vi.useFakeTimers();
    let open = "1";
    const opening = waitForChat(() => open, "2");
    setTimeout(() => { open = "2"; }, 120);
    await vi.advanceTimersByTimeAsync(200);
    await expect(opening).resolves.toBe(true);
    const never = waitForChat(() => "1", "3");
    await vi.advanceTimersByTimeAsync(3000);
    await expect(never).resolves.toBe(false);
    vi.useRealTimers();
  });
});
