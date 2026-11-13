import { beforeEach, describe, expect, it, vi } from "vitest";
import { peopleApi } from "../../src/components/mercbot/homesApi.js";

// The people in a home, as the group chats' Add person reads them (D-36). JSKIT answers the list a page at a time (20
// unless asked for more, at most 100), each page with the cursor of the next; the page shows every one. The routes are
// a stand-in that answers pages of the list and records each call.
const calls = vi.hoisted(() => []);
const lists = vi.hoisted(() => ({ members: [] }));
vi.mock("@jskit-ai/http-runtime/client", () => ({
  createHttpClient: () => ({
    async request(url) {
      calls.push(url);
      const { pathname, searchParams } = new URL(url, "http://mercbot.test");
      const list = pathname.split("/").pop();
      const size = Math.min(Number(searchParams.get("limit")) || 20, 100);
      const start = Number(searchParams.get("cursor") || 0);
      const entries = lists[list].slice(start, start + size);
      const nextCursor = start + size < lists[list].length ? String(start + size) : null;
      return { data: { type: `workspace-${list}`, attributes: { [list]: entries, nextCursor } } };
    }
  })
}));

const person = (index) => ({ userId: String(index), email: `person-${index}@example.test`, roleSid: "member" });

beforeEach(() => {
  calls.length = 0;
});

describe("a home's lists", () => {
  it("reads every person in a home of 205, a page of 100 at a time", async () => {
    lists.members = Array.from({ length: 205 }, (_, index) => person(index + 1));
    const people = await peopleApi.members("big home");
    expect(people.map((entry) => entry.userId)).toEqual(lists.members.map((entry) => entry.userId));
    expect(calls).toEqual([
      "/api/w/big%20home/members?limit=100",
      "/api/w/big%20home/members?limit=100&cursor=100",
      "/api/w/big%20home/members?limit=100&cursor=200"
    ]);
  });
});
