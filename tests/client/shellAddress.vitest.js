import { effectScope, reactive } from "vue";
import { describe, expect, it, vi } from "vitest";
import { useShellAddress } from "../../src/components/mercbot/useShellAddress.js";

// What the shell shows, named in the address (D-112): a member's card the address names opens in Details, from a reload
// or a link as from a tap; and choosing the chat already shown names it in place, whether the address named it or
// showed the list's first, so Back never lands on the same chat. The route and router are stand-ins recording each call.

function shellAt(query, shown = "") {
  const route = reactive({ query });
  const router = { push: vi.fn(), replace: vi.fn() };
  const showDetails = vi.fn();
  const scope = effectScope();
  const address = scope.run(() => useShellAddress({ route, router, openDirect: vi.fn(), showDetails, shownChatId: () => shown }));
  return { address, router, showDetails, stop: () => scope.stop() };
}

describe("the shell's address", () => {
  it("opens the card of a member it names, as a reload or a shared link does", () => {
    const named = shellAt({ team: "1", member: "bot:7" });
    expect(named.showDetails).toHaveBeenCalledTimes(1);
    named.stop();
    const team = shellAt({ team: "1" });
    expect(team.showDetails).not.toHaveBeenCalled();
    team.stop();
  });

  it("names the chat shown in place, even when the address showed the list's first, and adds an entry for another", () => {
    const first = shellAt({}, "4");
    first.address.showChat("4");
    first.address.showChat("5");
    expect([first.router.replace.mock.calls, first.router.push.mock.calls]).toEqual([[[{ query: { chat: "4" } }]], [[{ query: { chat: "5" } }]]]);
    first.stop();
    const fromTeam = shellAt({ team: "1" }, "4");
    fromTeam.address.showChat("4");
    expect(fromTeam.router.push).toHaveBeenCalledWith({ query: { chat: "4" } });
    fromTeam.stop();
  });
});
