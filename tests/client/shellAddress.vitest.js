import { effectScope, nextTick, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import { shellPreferences } from "../../src/components/mercbot/shellPreferences.js";
import { useShellAddress } from "../../src/components/mercbot/useShellAddress.js";

// What the shell shows, named in the address (D-112): a member's card the address names opens in Details beside the
// chat, from a reload or a link as from a tap; a link to a bot's files opens its direct chat with its card at Files; the
// old ?team=1 is ignored; and choosing the chat already shown names it in place, whether the address named it or
// showed the list's first, so Back never lands on the same chat. The route and router are stand-ins recording each call.

function shellAt(query, shown = "") {
  const route = reactive({ query });
  const go = (to) => {
    route.query = to.query;
  };
  const router = { push: vi.fn(go), replace: vi.fn(go) };
  const showDetails = vi.fn();
  const openDirect = vi.fn();
  const scope = effectScope();
  const address = scope.run(() => useShellAddress({ route, router, openDirect, showDetails, shownChatId: () => shown }));
  return { address, router, showDetails, openDirect, stop: () => scope.stop() };
}

describe("the shell's address", () => {
  it("opens the card of a member it names beside the chat, as a reload or a shared link does", () => {
    const named = shellAt({ chat: "4", member: "bot:7" });
    expect(named.showDetails).toHaveBeenCalledTimes(1);
    named.stop();
    const plain = shellAt({ chat: "4" });
    expect(plain.showDetails).not.toHaveBeenCalled();
    plain.stop();
  });

  it("opens a member's card beside the chat shown, keeping that chat in the address", () => {
    const shell = shellAt({}, "4");
    shell.address.showMember("person:2");
    expect(shell.router.replace.mock.calls).toEqual([[{ query: { chat: "4", member: "person:2" } }]]);
    shell.stop();
  });

  it("opens a bot's direct chat with its card at its Files from the home's Files page link (?bot=<id>&files=1)", async () => {
    const link = shellAt({ bot: "7", files: "1" });
    await nextTick();
    expect(link.openDirect.mock.calls).toEqual([["7", true]]);
    expect([shellPreferences.detailsTab, link.showDetails.mock.calls.length]).toEqual(["files", 1]);
    shellPreferences.detailsTab = "details";
    link.stop();
  });

  it("ignores the old Team page's ?team=1: nothing opens but the chat", () => {
    const old = shellAt({ team: "1" }, "4");
    expect([old.showDetails.mock.calls.length, old.openDirect.mock.calls.length, old.router.replace.mock.calls.length]).toEqual([0, 0, 0]);
    old.address.showChat("4");
    expect(old.router.replace).toHaveBeenCalledWith({ query: { chat: "4" } });
    old.stop();
  });

  it("names the chat shown in place, even when the address showed the list's first, and adds an entry for another", () => {
    const first = shellAt({}, "4");
    first.address.showChat("4");
    first.address.showChat("5");
    expect([first.router.replace.mock.calls, first.router.push.mock.calls]).toEqual([[[{ query: { chat: "4" } }]], [[{ query: { chat: "5" } }]]]);
    first.stop();
  });
});
