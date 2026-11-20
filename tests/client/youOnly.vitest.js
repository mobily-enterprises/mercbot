import { nextTick, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";
import { composerPlaceholder } from "../../src/components/mercbot/composerPlaceholder.js";
import { followOpenTabs, ownTabOf, ownTabOpen, placeQuery } from "../../src/components/mercbot/openTabs.js";
import { pageAccess } from "../../src/components/mercbot/useBotLibrary.js";
import { useBotMessages } from "../../src/components/mercbot/useBotMessages.js";
import { useSharingChoice } from "../../src/components/mercbot/useSharingChoice.js";

// Whether the home has anyone else in it, as homesApi reads it: set per test.
let others = false;
vi.mock("../../src/components/mercbot/homesApi.js", () => ({ hasOthers: async () => others }));

// A Shared bot's last tab, "You only" (D-99): the person's own conversation. Its files and computer are addressed by
// the tab, the composer and a page's sharing say who sees it, and Who sees what asks before every change.
const tabs = [{ id: "21", title: "General" }, { id: "22", title: "Plans" }, { id: "7", title: "You only", own: true }];
const inGeneral = { id: "4", name: "Otto", sharing: "shared", roomId: "21", rooms: tabs };
const inYouOnly = { ...inGeneral, roomId: "7" };

afterEach(() => {
  followOpenTabs(() => null);
});

describe("a bot's files and computer follow its open tab", () => {
  it("name the tab given, else the one the bot has open, and a group over either", () => {
    followOpenTabs((botId) => ({ 4: "7", 5: null })[botId] ?? null);
    expect(placeQuery("4")).toBe("room=7");
    expect(placeQuery("4", { room: "21" })).toBe("room=21");
    expect(placeQuery("4", { room: null }), "null names no tab: the server's choice").toBe("");
    expect(placeQuery("4", { group: "9" })).toBe("group=9");
    expect(placeQuery("5"), "a bot with no tabs").toBe("");
    expect(placeQuery(null)).toBe("");
  });

  it("know You only by its tab, not its name", () => {
    expect(ownTabOf(inGeneral)).toBe("7");
    expect([ownTabOpen(inGeneral), ownTabOpen(inYouOnly)]).toEqual([false, true]);
    expect(ownTabOpen({ ...inGeneral, rooms: [{ id: "21", title: "You only" }], roomId: "21" }), "a shared tab named You only is shared").toBe(false);
    expect([ownTabOf({ name: "Otto", rooms: null }), ownTabOpen({ name: "Otto", roomId: null })]).toEqual([null, false]);
  });
});

describe("who sees what's written", () => {
  it("says only the person sees You only, and everyone sees a shared tab", () => {
    const placeholder = (bot) => composerPlaceholder({ pickerNames: null, messages: [], bot, homeName: "Casa" });
    expect(placeholder(inGeneral)).toBe("Message Otto · everyone in Casa sees this");
    expect(placeholder(inYouOnly)).toBe("Message Otto · only you see this");
  });

  it("keeps a page made in You only the person's own", () => {
    expect(pageAccess(inYouOnly, "/files/mine/Pages/plan.md", "Casa").title).toBe("Only you");
    expect(pageAccess(inYouOnly, "/files/bot/Pages/plan.md", "Casa").title).toBe("Everyone using Otto");
    expect(pageAccess(inGeneral, "/files/mine/Pages/plan.md", "Casa").title, "a shared tab's are everyone's").toBe("Everyone in Casa");
  });
});

describe("Who sees what", () => {
  const choiceFor = async (bot, { name = "Casa", alone = false } = {}) => {
    others = !alone;
    const chosen = [];
    const current = ref(bot);
    const choice = useSharingChoice({ bot: () => current.value, home: ref({ slug: "casa", name }), onChoose: (sharing) => chosen.push(sharing) });
    await Promise.resolve();
    await nextTick();
    return { choice, chosen, current };
  };

  it("adds to everyone's own chat, mode by mode", async () => {
    const { choice } = await choiceFor({ name: "Otto", sharing: "mixed", rooms: null });
    expect(choice.intro.value).toBe("Everyone in Casa has their own chat with Otto, which only they see.");
    expect(choice.options.value.map((option) => [option.value, option.text.split(" ")[0]])).toEqual([["private", "Nothing"], ["mixed", "And"], ["shared", "And"]]);
    expect(choice.options.value[2].text).toMatch(/each person's own chat is the last tab, You only/u);
  });

  it("is hidden in a home of one for a bot on the default, so it can always be set back", async () => {
    expect((await choiceFor({ name: "Otto", sharing: "mixed" }, { alone: true })).choice.shown.value).toBe(false);
    expect((await choiceFor({ name: "Otto", sharing: "shared" }, { alone: true })).choice.shown.value).toBe(true);
    expect((await choiceFor({ name: "Otto", sharing: "private" }, { alone: true })).choice.shown.value).toBe(true);
    expect((await choiceFor({ name: "Otto", sharing: "mixed" })).choice.shown.value).toBe(true);
  });

  it("asks before every change, naming what it hides and for whom", async () => {
    const { choice, chosen } = await choiceFor({ name: "Otto", sharing: "mixed", rooms: null });
    choice.ask("mixed");
    expect(choice.question.value, "choosing the mode it has asks nothing").toBe(null);
    choice.ask("shared");
    expect(choice.question.value.title).toBe("Make Otto Shared?");
    expect(choice.question.value.confirmLabel).toBe("Make it Shared");
    expect(choice.question.value.text).toMatch(/everyone in Casa .* starting with General\. Each person's own chat stays theirs alone, as the last tab, You only\. Otto stops using Casa's notebook/u);
    choice.cancel();
    expect([choice.question.value, chosen]).toEqual([null, []]);
    choice.ask("shared");
    choice.confirm();
    expect([choice.question.value, chosen]).toEqual([null, ["shared"]]);
  });

  it("says leaving Shared hides the shared tabs from everyone and pauses their work", async () => {
    const { choice, chosen } = await choiceFor(inGeneral);
    choice.ask("private");
    expect(choice.question.value.text).toBe(
      "The shared conversations (“General”, “Plans”) are hidden from everyone in Casa, not deleted, until Otto is Shared again, " +
        "and their routines and watches pause. Each person's You only becomes their chat with Otto."
    );
    choice.confirm();
    expect(chosen).toEqual(["private"]);
    choice.ask("mixed");
    expect(choice.question.value.text).toMatch(/notes what helps everyone in Casa's notebook/u);
  });
});

describe("a Shared bot's line in the list", () => {
  it("takes the bot's replies in the shared tabs as they come, never one in You only", () => {
    const tabs = [{ id: "10", title: "General" }, { id: "12", title: "You only", own: true }];
    const bots = ref([
      { id: "1", sharing: "shared", rooms: tabs, roomId: "10", preview: "" },
      { id: "2", sharing: "shared", rooms: tabs, roomId: "12", preview: "Rota is up" },
      { id: "3", sharing: "mixed", rooms: null, roomId: null, preview: "" }
    ]);
    const store = useBotMessages({ bots, currentBotId: () => null });
    const reply = (id, text) => [{ id, role: "bot", kind: "text", body: { text } }];
    store.appendMessages("1", reply("100", "Trip booked"));
    store.appendMessages("2", reply("101", "Your private note"));
    store.appendMessages("3", reply("102", "Noted."));
    expect(bots.value.map((bot) => bot.preview)).toEqual(["Trip booked", "Rota is up", "Noted."]);
  });
});
