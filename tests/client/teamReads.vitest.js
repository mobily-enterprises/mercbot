import { describe, expect, it, vi } from "vitest";
import { botsApi } from "../../src/components/mercbot/botsApi.js";
import { peopleApi } from "../../src/components/mercbot/homesApi.js";
import { useTeam } from "../../src/components/mercbot/useTeam.js";

// The home's bots and people as the shell keeps them (useTeam.js): news can start a read while another is under way,
// and the answers can come back in either order. Only the read begun last is applied, so an older answer never drops a
// bot or person a newer one has.

vi.mock("../../src/components/mercbot/botsApi.js", () => ({ botsApi: { list: vi.fn() } }));
vi.mock("../../src/components/mercbot/homesApi.js", () => ({ peopleApi: { members: vi.fn() }, roleLabel: (role) => role }));

/** An answer the test lets go of when it says. */
function held() {
  let release;
  const answer = new Promise((resolve) => { release = resolve; });
  return { answer, release };
}

describe("the team's reads", () => {
  it("applies the answer of the read begun last, whichever answers first", async () => {
    const team = useTeam({ homeSlug: () => "casa", reportFailure: vi.fn() });
    const [olderBots, newerBots, olderPeople, newerPeople] = [held(), held(), held(), held()];
    botsApi.list.mockReturnValueOnce(olderBots.answer).mockReturnValueOnce(newerBots.answer);
    peopleApi.members.mockReturnValueOnce(olderPeople.answer).mockReturnValueOnce(newerPeople.answer);
    const reads = [team.loadBots(), team.loadBots(), team.loadPeople(), team.loadPeople()];
    newerBots.release({ bots: [{ id: "1", name: "Mercbot" }, { id: "2", name: "Chef" }] });
    newerPeople.release([{ userId: 1, displayName: "Anna Rossi" }, { userId: 2, displayName: "Ben Neri" }]);
    olderBots.release({ bots: [{ id: "1", name: "Mercbot" }] });
    olderPeople.release([{ userId: 1, displayName: "Anna Rossi" }]);
    await Promise.all(reads);
    expect(team.bots.value.map((bot) => bot.name)).toEqual(["Mercbot", "Chef"]);
    expect(team.people.value.map((person) => person.name)).toEqual(["Anna Rossi", "Ben Neri"]);
  });
});
