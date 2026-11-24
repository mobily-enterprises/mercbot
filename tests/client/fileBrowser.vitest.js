import { createSSRApp, h, ref } from "vue";
import { renderToString } from "vue/server-renderer";
import { createVuetify } from "vuetify";
import { createMaterialVuetifyOptions } from "@jskit-ai/material-web/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { theme } from "../../src/theme/index.js";

// The one file browser (D-47): its places (the chat it was opened from, Home files, the bots with the main bot first,
// the rooms and chats), the place picker's Copy here / Move here and the folders it can't take, a move inside one
// place versus a transfer between places, the question before a private chat's file goes wider and the retry once
// it's answered yes, what a drag says it will do (Ctrl, or ⌥ on a Mac, copies), Add from files copying into the chat
// and attaching, and the places as a picker at the top on a phone. The file routes are stand-ins.
const api = vi.hoisted(() => ({ calls: [], places: [], transfer: null }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ page: (path) => path }) }));
vi.mock("../../src/components/mercbot/filesApi.js", async (original) => ({
  ...(await original()),
  filesApi: {
    places: async () => ({ places: api.places }),
    list: async (botId, folder, chat) => {
      api.calls.push(["list", botId, folder, chat]);
      return { path: folder, entries: [{ path: `${folder}/Invoices`, folder: true }, { path: `${folder}/budget.xlsx`, size: 2048, modified: "2026-11-20T10:00:00Z" }] };
    },
    move: async (botId, from, to, chat) => {
      api.calls.push(["move", botId, from, to, chat]);
      return { path: to };
    },
    transfer: async (request) => {
      api.calls.push(["transfer", request]);
      return api.transfer(request);
    }
  }
}));

const { dropLabel, dropMode, orderPlaces, pickerAction, pickerLabel, pickerRefusal, startKey, useFolderListing } = await import("../../src/components/files/filePlaces.js");
const { useFileTransfer } = await import("../../src/components/files/useFileTransfer.js");
const { useComposerFiles } = await import("../../src/components/mercbot/useComposerFiles.js");
const { default: FileBrowser } = await import("../../src/components/files/FileBrowser.vue");

const PLACES = [
  { kind: "home", label: "Home files" },
  { kind: "bot", botId: "3", name: "Ledger", color: "blue", shape: "cloud" },
  { kind: "bot", botId: "4", name: "Chef", color: "green", shape: "cloud", main: true },
  { kind: "chat", chatId: "20", title: "Garden", private: false, direct: null, archived: false },
  { kind: "chat", chatId: "9", title: "Kitchen reno", private: true, direct: null, archived: false },
  { kind: "chat", chatId: "21", title: "Old trip", private: true, direct: null, archived: true }
];
const KITCHEN = { id: "9", title: "Kitchen reno", kind: "private", bots: [{ botId: "4" }], people: [] };

beforeEach(() => {
  api.calls = [];
  api.places = PLACES;
  api.transfer = async (request) => ({ path: `${request.to.folder}/${request.from.path.split("/").pop()}` });
});

describe("the browser's places", () => {
  it("lists the room it was opened from first, then Home files and Database files, the bots (main first) and the rooms", () => {
    const items = orderPlaces(PLACES, { chat: KITCHEN, chatBotId: "4" });
    expect(items.map((item) => [item.label, item.group])).toEqual([
      ["This room", "here"], ["Home files", "home"], ["Database files", "home"], ["Chef", "bots"], ["Ledger", "bots"], ["Garden", "chats"], ["Old trip", "chats"]
    ]);
    // The room's folder is reached through its bot, so the viewer can open a file on that bot's computer; the others name
    // the bot or chat alone, and the home's neither.
    expect(items.map((item) => [item.key, item.botId, item.chat, item.root])).toEqual([
      ["chat:9", "4", "9", "/files/chat"], ["home", null, null, "/files/shared"], ["db", null, null, "/files/db"], ["bot:4", "4", null, "/files/bot"],
      ["bot:3", "3", null, "/files/bot"], ["chat:20", null, "20", "/files/chat"], ["chat:21", null, "21", "/files/chat"]
    ]);
    expect(items.map((item) => item.title)).toEqual(["this room", "Home files", "Database files", "Chef's files", "Ledger's files", "Garden", "Old trip"]);
    // The records' files (D-130): read through the home's own place, and locked.
    expect(items.find((item) => item.key === "db")).toMatchObject({ place: { kind: "home" }, locked: true, icon: "$lock" });
    expect(items.find((item) => item.key === "chat:21").archived).toBe(true);
  });

  it("calls a direct chat This chat, adds the chat it's in when the list lacks it, and lists no chat first from the Files page", () => {
    const direct = { id: "57", directBotId: "4", bots: [{ botId: "4" }], people: [] };
    expect(orderPlaces(PLACES, { chat: direct })[0]).toMatchObject({ key: "chat:57", label: "This chat", group: "here" });
    expect(orderPlaces(PLACES).map((item) => item.label)).toEqual(["Home files", "Database files", "Chef", "Ledger", "Garden", "Kitchen reno", "Old trip"]);
  });

  it("names a direct chat as a chat with someone, never like that bot's own files", () => {
    const withChats = [...PLACES, { kind: "chat", chatId: "30", title: "Ledger", private: true, direct: "bot", archived: false },
      { kind: "chat", chatId: "31", title: "Ben Rossi", private: true, direct: "person", archived: false }];
    const labels = orderPlaces(withChats).map((item) => item.label);
    expect(labels).toContain("Chat with Ledger");
    expect(labels).toContain("Chat with Ben Rossi");
    expect(labels.filter((label) => label === "Ledger")).toHaveLength(1);
  });

  it("names each place on its own in the picker: a bot's files as its files", () => {
    expect(orderPlaces(PLACES).map(pickerLabel)).toEqual(["Home files", "Database files", "Chef's files", "Ledger's files", "Garden", "Kitchen reno", "Old trip"]);
  });

  it("starts a bot's breadcrumbs with its files, not its bare name, which a chat with it would also have", async () => {
    const chef = orderPlaces(PLACES).find((item) => item.kind === "bot" && item.label === "Chef");
    const listing = useFolderListing();
    await listing.go(chef);
    expect(listing.crumbs.value[0]).toEqual({ label: "Chef's files", path: chef.root });
  });

  it("opens at the bot's files on its card, at the chat's in its details, else at Home files", () => {
    expect(startKey({ botId: "4", chat: KITCHEN })).toBe("bot:4");
    expect(startKey({ chat: KITCHEN })).toBe("chat:9");
    expect(startKey()).toBe("home");
  });
});

describe("the place picker", () => {
  const items = orderPlaces(PLACES, { chat: KITCHEN });
  const at = (key) => items.find((item) => item.key === key);

  it("says Copy here or Move here, and for Add from files how many it adds", () => {
    expect([pickerAction("copy"), pickerAction("move"), pickerAction("add", 0), pickerAction("add", 1), pickerAction("add", 3)])
      .toEqual(["Copy here", "Move here", "Add files", "Add 1 file", "Add 3 files"]);
  });

  it("refuses an archived chat, a folder into itself, and a move to where it already is; a copy there is fine", () => {
    const file = { from: "chat:9", path: "/files/chat/Plans/budget.xlsx" };
    expect(pickerRefusal({ mode: "move", item: at("chat:21"), folder: "/files/chat", ...file })).toBe("This chat is archived: nothing new can go in it.");
    expect(pickerRefusal({ mode: "move", item: at("chat:9"), folder: "/files/chat/Plans", ...file })).toBe("It's already here.");
    expect(pickerRefusal({ mode: "copy", item: at("chat:9"), folder: "/files/chat/Plans", ...file })).toBe("");
    expect(pickerRefusal({ mode: "move", item: at("chat:9"), folder: "/files/chat", ...file })).toBe("");
    expect(pickerRefusal({ mode: "move", item: at("home"), folder: "/files/shared/Plans", ...file })).toBe("");
    // Nothing is copied or moved into Database files (D-130).
    for (const mode of ["copy", "move"]) expect(pickerRefusal({ mode, item: at("db"), folder: "/files/db/tables", ...file })).toMatch(/belong to their table's records/u);
    // It says what's refused (putting something there) and what to do, not what can be done with the files already there.
    expect(pickerRefusal({ mode: "copy", item: at("db"), folder: "/files/db/tables", ...file }))
      .toBe("Database files belong to their table's records: nothing can be copied or moved in. Choose another place.");
    const folder = { from: "chat:9", path: "/files/chat/Plans" };
    expect(pickerRefusal({ mode: "move", item: at("chat:9"), folder: "/files/chat/Plans/2026", ...folder })).toBe("A folder can't go inside itself.");
    expect(pickerRefusal({ mode: "copy", item: at("chat:9"), folder: "/files/chat/Plans", ...folder })).toBe("A folder can't go inside itself.");
  });
});

describe("copying and moving", () => {
  const items = orderPlaces(PLACES, { chat: KITCHEN, chatBotId: "4" });
  const at = (key) => items.find((item) => item.key === key);
  const reported = [];
  const transferring = () => useFileTransfer({ report: (error, fallback) => reported.push(error?.message || fallback) });

  it("moves inside one place with the place's own move, into the folder chosen", async () => {
    const { transfer } = transferring();
    expect(await transfer({ mode: "move", from: at("chat:9"), path: "/files/chat/budget.xlsx", to: at("chat:9"), folder: "/files/chat/Invoices" })).toBe("/files/chat/Invoices/budget.xlsx");
    expect(api.calls).toEqual([["move", "4", "/files/chat/budget.xlsx", "/files/chat/Invoices/budget.xlsx", "9"]]);
  });

  it("copies, and moves between places, with a transfer naming both places and the folder chosen", async () => {
    const { transfer } = transferring();
    await transfer({ mode: "copy", from: at("chat:9"), path: "/files/chat/budget.xlsx", to: at("chat:9"), folder: "/files/chat" });
    await transfer({ mode: "move", from: at("home"), path: "/files/shared/budget.xlsx", to: at("bot:3"), folder: "/files/bot/Invoices" });
    expect(api.calls).toEqual([
      ["transfer", { mode: "copy", from: { place: { kind: "chat", chatId: "9" }, path: "/files/chat/budget.xlsx" }, to: { place: { kind: "chat", chatId: "9" }, folder: "/files/chat" } }],
      ["transfer", { mode: "move", from: { place: { kind: "home" }, path: "/files/shared/budget.xlsx" }, to: { place: { kind: "bot", botId: "3" }, folder: "/files/bot/Invoices" } }]
    ]);
  });

  it("asks before a private room's file goes wider, and sends it again confirmed on Continue", async () => {
    api.transfer = async (request) => {
      if (!request.confirmed) throw Object.assign(new Error("Everyone who can open Home files will see it."), { status: 409, code: "files_wider_needs_confirm" });
      return { path: "/files/shared/budget.xlsx" };
    };
    const { question, asking, confirm, transfer } = transferring();
    const done = transfer({ mode: "move", from: at("chat:9"), path: "/files/chat/budget.xlsx", to: at("home"), folder: "/files/shared" });
    await vi.waitFor(() => expect(asking.value).toBe(true));
    expect(question.value).toBe("Everyone who can open Home files will see this file. Continue?");
    confirm();
    expect(await done).toBe("/files/shared/budget.xlsx");
    expect(api.calls.map(([, request]) => request.confirmed ?? false)).toEqual([false, true]);
    expect(asking.value).toBe(false);
  });

  it("does nothing more when the question is closed, and reports any other refusal in the server's words", async () => {
    api.transfer = async () => {
      throw Object.assign(new Error("wider"), { status: 409, code: "files_wider_needs_confirm" });
    };
    const { asking, transfer } = transferring();
    const done = transfer({ mode: "copy", from: at("chat:9"), path: "/files/chat/budget.xlsx", to: at("bot:3"), folder: "/files/bot" });
    await vi.waitFor(() => expect(asking.value).toBe(true));
    asking.value = false;
    expect(await done).toBe(null);
    expect(api.calls).toHaveLength(1);

    reported.length = 0;
    api.transfer = async () => {
      throw Object.assign(new Error("This chat is archived."), { status: 409, code: "bots_chat_archived" });
    };
    expect(await transfer({ mode: "copy", from: at("home"), path: "/files/shared/a.txt", to: at("chat:21"), folder: "/files/chat" })).toBe(null);
    expect(reported).toEqual(["This chat is archived."]);
  });
});

describe("dragging onto a place", () => {
  const home = orderPlaces(PLACES)[0];
  it("moves, or copies with Ctrl held (⌥ on a Mac), and the place says which", () => {
    expect(dropMode({ ctrlKey: false, altKey: false }, false)).toBe("move");
    expect(dropMode({ ctrlKey: true, altKey: false }, false)).toBe("copy");
    expect(dropMode({ ctrlKey: false, altKey: true }, false), "⌥ alone elsewhere moves").toBe("move");
    expect(dropMode({ ctrlKey: false, altKey: true }, true)).toBe("copy");
    expect(dropMode({ ctrlKey: true, altKey: false }, true), "Ctrl on a Mac is a right click, not a copy").toBe("move");
    expect([dropLabel("move", home), dropLabel("copy", home)]).toEqual(["Move to Home files", "Copy to Home files"]);
  });
});

describe("Add from files", () => {
  it("copies each file chosen into this chat's Uploads and attaches it; one not copied is left out", async () => {
    const items = orderPlaces(PLACES, { chat: KITCHEN });
    const here = items[0];
    const failures = [];
    const { transfer } = useFileTransfer({ report: (error) => failures.push(error.message) });
    api.transfer = async (request) => {
      if (request.from.path.endsWith("secret.txt")) throw Object.assign(new Error("That file isn't there any more."), { status: 404 });
      return { path: `${request.to.folder}/${request.from.path.split("/").pop()}` };
    };
    const attachments = ref([]);
    let focused = 0;
    const { addCopies } = useComposerFiles({ attachments, chat: () => KITCHEN, focusComposer: () => { focused += 1; }, onFailure: () => {}, transfer });
    await addCopies([
      { item: items[1], path: "/files/shared/budget.xlsx", size: 2048 },
      { item: items[4], path: "/files/bot/secret.txt", size: 10 },
      { item: items[5], path: "/files/chat/photo.png", size: 4096 }
    ], here);
    expect(api.calls.map(([, request]) => [request.mode, request.from.place, request.to])).toEqual([
      ["copy", { kind: "home" }, { place: { kind: "chat", chatId: "9" }, folder: "/files/chat/Uploads" }],
      ["copy", { kind: "bot", botId: "3" }, { place: { kind: "chat", chatId: "9" }, folder: "/files/chat/Uploads" }],
      ["copy", { kind: "chat", chatId: "20" }, { place: { kind: "chat", chatId: "9" }, folder: "/files/chat/Uploads" }]
    ]);
    expect(attachments.value.map(({ name, size, path }) => ({ name, size, path }))).toEqual([
      { name: "budget.xlsx", size: 2048, path: "/files/chat/Uploads/budget.xlsx" },
      { name: "photo.png", size: 4096, path: "/files/chat/Uploads/photo.png" }
    ]);
    expect(failures).toEqual(["That file isn't there any more."]);
    expect(focused).toBe(1);
  });
});

describe("the browser on a wide screen and on a phone", () => {
  /** The browser's HTML at `clientWidth`, once its places and first folder have come. */
  async function browser(props, clientWidth) {
    const app = createSSRApp({ render: () => h(FileBrowser, props) });
    app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: { clientWidth } }));
    app.mixin({ serverPrefetch() { return this.$.type === FileBrowser ? new Promise((resolve) => setTimeout(resolve, 20)) : undefined; } });
    return (await renderToString(app)).replaceAll("&#39;", "'").replace(/ data-v-[0-9a-f]+/gu, "");
  }
  const text = (html) => html.replace(/<[^>]*>/gu, " ").replace(/\s+/gu, " ").trim();

  it("shows the places as a column, in order and grouped, opened at the room it's in", async () => {
    const html = await browser({ chat: KITCHEN }, 1280);
    const nav = /<nav class="mb-files__places"[\s\S]*?<\/nav>/u.exec(html)?.[0] || "";
    expect(text(nav)).toBe("This room Home files Database files Bots Chef Ledger Rooms and chats Garden Old trip");
    expect(/<button[^>]*aria-current="true"[^>]*>[\s\S]*?<\/button>/u.exec(nav)?.[0]).toContain("This room");
    expect(html).not.toContain("mb-files__place-picker");
    expect(api.calls.find(([name]) => name === "list")).toEqual(["list", "4", "/files/chat", "9"]);
    expect(html).toContain("budget.xlsx");
    expect(html).toContain("aria-label=\"More for budget.xlsx\"");
  });

  it("in an archived chat, says why nothing new can go in, where New folder and Upload are off", async () => {
    const oldTrip = { id: "21", title: "Old trip", kind: "private", bots: [], people: [], archivedAt: "2026-01-01T00:00:00Z" };
    const html = await browser({ chat: oldTrip }, 1280);
    expect(html).toContain("This chat is archived: nothing new can go in it.");
    expect(html).toMatch(/<button[^>]*disabled[^>]*aria-label="Upload to/u);
    const open = await browser({ chat: KITCHEN }, 1280);
    expect(open, "a chat that isn't archived says nothing of it").not.toContain("is archived");
  });

  it("in Database files, says they belong to their records, with no New folder or Upload, and lists them to open", async () => {
    const app = createSSRApp({ render: () => h(FileBrowser, {}) });
    app.use(createVuetify({ ...createMaterialVuetifyOptions(theme), ssr: { clientWidth: 1280 } }));
    app.mixin({
      async serverPrefetch() {
        if (this.$.type !== FileBrowser) return;
        await new Promise((resolve) => setTimeout(resolve, 20));
        this.$.setupState.openPlace("db");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    });
    const html = (await renderToString(app)).replaceAll("&#39;", "'").replace(/ data-v-[0-9a-f]+/gu, "");
    expect(html).toContain("These files belong to their table's records: open one or copy it out, but nothing here is moved, renamed or deleted.");
    expect(html).not.toContain("aria-label=\"Upload to");
    expect(html).not.toContain("aria-label=\"New folder in");
    expect(api.calls.at(-1)).toEqual(["list", null, "/files/db", null]);
    expect(html).toContain("aria-label=\"More for budget.xlsx\"");
  });

  it("puts the places in a picker at the top on a phone, with no column", async () => {
    const html = await browser({}, 390);
    expect(html).toContain("mb-files__place-picker");
    expect(html).not.toContain("mb-files__places");
    expect(api.calls.find(([name]) => name === "list")).toEqual(["list", null, "/files/shared", null]);
  });
});
