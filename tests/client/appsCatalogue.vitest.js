import { describe, expect, it } from "vitest";
import {
  accountLine, actionLabel, addAccountStep, availability, removeAppQuestion, sharedWith, signInName, signsIn
} from "../../src/components/mercbot/appsCatalogue.js";

// Connect apps' words for an app people sign in to: through Google, Microsoft or GitHub (`oauth`), or through the
// app's own connection point (`mcp`, the general connector, D-34), which is connected like any other once built.
const info = { availability: "Coming soon" };
const notion = (fields = {}) => ({ id: "notion", mcp: { url: "https://mcp.notion.com/mcp" }, info, accounts: [], installed: false, ...fields });

describe("an app that hosts its own connection point", () => {
  it("is signed in to, so it is added, then follows its accounts", () => {
    expect(signsIn(notion())).toBe(true);
    expect(signsIn({ oauth: { provider: "google" } })).toBe(true);
    expect(signsIn({ id: "trello", soon: true })).toBe(false);
    expect(actionLabel(notion())).toBe("Add");
    expect(availability(notion())).toBe("Not added yet");
    expect(availability(notion({ installed: true, accounts: [{ status: "needs-auth" }] }))).toBe("Added; needs sign-in");
    expect(availability(notion({ installed: true, accounts: [{ status: "connected" }, { status: "connected" }] }))).toBe("Connected (2 accounts)");
    expect(availability({ id: "trello", soon: true, info, accounts: [] })).toBe("Coming soon");
  });
});

// One account line for every app (D-110, D-111): every line has the bin, the first and the only one too, and says in
// words that everyone in the home and their bots use the account, and who added it; only the person who added it and
// the home's owners and admins (the server's canChange) rename, remove or sign it in again.
describe("an account's line", () => {
  const gmail = { id: "gmail", name: "Gmail", oauth: { provider: "google" } };
  const drive = { id: "google-drive", name: "Google Drive", oauth: { provider: "google" } };
  const sedna = { id: "sedna", name: "Sedna", credentials: { home: true, button: "Enter API credentials" } };
  const where = { homeName: "Rivera" };
  const yours = { addedByYou: true, addedBy: "Kim", canChange: true, status: "connected", label: "kim@rivera.example", name: "" };
  const lees = { addedByYou: false, addedBy: "Lee", canChange: false, status: "needs-auth", label: "bookings@rivera.example", name: "" };

  it("says everyone in the home and their bots use it, and who added it", () => {
    expect(accountLine(yours, gmail, where)).toMatchObject({
      who: "Everyone in Rivera, and their bots, can read and send from kim@rivera.example.", addedBy: "you",
      canChange: true, canRemove: true, status: "Connected", signIn: "",
      removeQuestion: "Remove it for everyone in Rivera? Their bots stop using it."
    });
    expect(accountLine(lees, gmail, where)).toMatchObject({
      who: "Everyone in Rivera, and their bots, can read and send from bookings@rivera.example.", addedBy: "Lee",
      canChange: false, canRemove: false
    });
    // Not a mailbox: used, not read and sent from.
    expect(accountLine(yours, drive, where).who).toBe("Everyone in Rivera, and their bots, can use kim@rivera.example.");
    // The home's owners and admins change any account: the server says so.
    expect(accountLine({ ...lees, canChange: true }, gmail, where)).toMatchObject({ addedBy: "Lee", canChange: true, canRemove: true });
    // Never a switch.
    expect(accountLine(yours, gmail, where)).not.toHaveProperty("canSwitch");
    // Before sign-in there's no address yet.
    expect(accountLine({ ...yours, label: null, status: "needs-auth" }, gmail, where).who)
      .toBe("Everyone in Rivera, and their bots, can read and send from the account you connect.");
  });

  it("signs in again to the address it has", () => {
    expect(accountLine({ ...yours, status: "needs-auth" }, gmail, where)).toMatchObject({ status: "Needs sign-in", signIn: "Sign in again" });
    expect(accountLine({ ...yours, status: "needs-auth", label: null }, gmail, where).signIn).toBe("Sign in");
    expect(accountLine({ ...yours, status: "failed" }, gmail, where).signIn).toBe("Retry");
    expect(accountLine({ ...yours, status: "more-access" }, gmail, where)).toMatchObject({ status: "Needs more access", signIn: "Sign in again" });
    const sednas = { addedByYou: true, canChange: true, status: "needs-auth", label: null, name: "" };
    expect(accountLine(sednas, sedna, where)).toMatchObject({ canRemove: true, status: "Not connected", signIn: "Enter API credentials" });
  });
});

describe("who uses an app's accounts, in words", () => {
  it("names reading and sending for a mailbox, using for any other app, with the address or the account you connect", () => {
    expect(sharedWith({ id: "gmail" }, "Rivera", "kim@rivera.example")).toBe("Everyone in Rivera, and their bots, can read and send from kim@rivera.example.");
    expect(sharedWith({ id: "outlook" }, "Rivera")).toBe("Everyone in Rivera, and their bots, can read and send from the account you connect.");
    expect(sharedWith({ id: "google-calendar" }, "Rivera", "kim@rivera.example")).toBe("Everyone in Rivera, and their bots, can use kim@rivera.example.");
    expect(sharedWith({ id: "notion" }, "Rivera")).toBe("Everyone in Rivera, and their bots, can use the account you connect.");
  });
});

describe("removing an app from the home", () => {
  it("asks first, saying how many accounts go with it", () => {
    const gmail = (accounts) => ({ name: "Gmail", accounts });
    expect(removeAppQuestion(gmail([]), "Rivera")).toBe("Remove Gmail from Rivera? Everyone's bots stop using it.");
    expect(removeAppQuestion(gmail([{ id: "1" }]), "Rivera")).toBe("Remove Gmail from Rivera, with its account? Everyone's bots stop using it.");
    expect(removeAppQuestion(gmail([{ id: "1" }, { id: "2" }]), "Rivera")).toBe("Remove Gmail from Rivera, with its 2 accounts? Everyone's bots stop using it.");
  });
});

// The Add account step (D-110): a label that may stay empty, that everyone in the home and their bots will use it
// (D-111), and what opens next.
describe("the Add account step", () => {
  it("says a window opens on a computer, that the sign-in takes the tab on a phone, and names whose sign-in it is", () => {
    const gmail = { name: "Gmail", oauth: { provider: "google" } };
    expect(addAccountStep(gmail, false)).toEqual({ note: "A Google window opens so you can pick the account.", submit: "Sign in with Google" });
    expect(addAccountStep(gmail, true)).toEqual({ note: "Google's sign-in opens here, then brings you back.", submit: "Sign in with Google" });
    expect(addAccountStep({ name: "Outlook", oauth: { provider: "microsoft" } }, false).submit).toBe("Sign in with Microsoft");
    expect(signInName({ name: "Notion", mcp: { url: "https://mcp.notion.com/mcp" } })).toBe("Notion");
    expect(addAccountStep({ name: "Sedna", credentials: { home: true } }, false)).toEqual({ note: "You enter Sedna's API credentials next.", submit: "Add" });
  });
});
