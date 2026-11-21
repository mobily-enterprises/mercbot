import { resolveAuditActorId } from "@jskit-ai/kernel/server/actions/actionContributorHelpers";
import { AppError } from "@jskit-ai/kernel/server/runtime/errors";

// What a computer's sign-ins are (D16): a website's, a coding tool's, or Sedna's (D-93).
const SIGN_IN_KINDS = new Set(["site", "coding", "sedna"]);

/** A page address's host, or "" for one that isn't an address. */
function hostOf(url) {
  try {
    return new URL(String(url)).hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

// Taking over a chat's computer (D16). A bot's computer in a chat is the chat's (D14), so anyone who can open the chat
// can take it over, from the bot or from another person, and anyone who can open it can hand it back. While a person
// has control the bot doesn't act on it (`heldOff`); a computer that goes to sleep is the bot's again (computerRecords).
// Each take-over and hand-back is a line in the chat, and the chat's people and whoever did it hear of it, on any
// server: a "messages" event for the line and a "computer" event for the control, on bot-events, and the computer's own
// notice for its screens.

/** What a computer the caller can't reach answers: the same 404 whether it's missing or in a chat they can't open. */
export const computerNotFound = () => new AppError(404, "That computer isn't here.", { code: "computer_not_found" });

/** The person a call is for: the signed-in user, or the person work is done for. */
function personOf(options) {
  const person = resolveAuditActorId(options?.context);
  if (!person) throw new TypeError("Taking over a computer is a person's: the call has none.");
  return String(person);
}

/**
 * @param {object} dependencies
 * @param {import("./types.js").ComputerRecords} dependencies.records
 * @param {{ computerOf: Function }} dependencies.directory records.directory: a computer's bot in its chat, as the
 *   caller may read it
 * @param {{ names: Function, people: Function }} dependencies.chats records.chats
 * @param {{ append: Function }} dependencies.messages records.messages
 * @param {import("@local/notices/server/types").Notices} dependencies.notices
 * @param {(computerId: string) => Promise<unknown>} dependencies.wake wakes the computer wherever it runs
 * @param {() => object} dependencies.system the computer feature's system context, as call options: the bot's own calls
 *   run on no request
 */
export function createComputerControl({ records, directory, chats, messages, notices, wake, system }) {
  /** The computer as the caller may reach it: its bot in a chat they can open, or a 404. */
  async function placeOf(chatBotId, options) {
    const found = await directory.computerOf(String(chatBotId), options);
    if (!found) throw computerNotFound();
    return found;
  }

  /** A control `{ userId, since }` with its person's name, or null. */
  async function named(control, options) {
    if (!control) return null;
    const names = await chats.names([control.userId], options);
    return { ...control, name: names.get(control.userId) || "Someone" };
  }

  /** The chat's people and whoever did it hear of the line and the control, on any server; a failure only warns. */
  async function tell(found, control, actorId, options) {
    const people = (await chats.people(found.chatId, options)).map((person) => String(person.user_id));
    const to = [...new Set([...people, actorId])];
    await Promise.all([
      notices.publishEach("bots", to, { type: "messages", chatId: found.chatId }),
      notices.publishEach("bots", to, { type: "computer", chatId: found.chatId, botId: found.botId, control }),
      notices.publish("computer", found.chatBotId, {})
    ]).catch((error) => console.warn("Telling people a computer changed hands failed; they see it on their next read.", error));
  }

  /** The line in the chat, as Mercbot's own (system lines aren't anyone's unread). */
  function line(found, text, control) {
    return {
      role: "system",
      kind: "event",
      body: { text, icon: "computer", computer: { chatBotId: found.chatBotId, botId: found.botId, control: control?.userId ?? null } }
    };
  }

  /**
   * The caller takes over the bot's computer in a chat they can open: it wakes for them if it's asleep. Taking it from
   * another person names them; taking it again changes nothing. Answers `{ messages, control }`: the line posted and
   * who has control now.
   */
  async function takeOver(chatBotId, options) {
    const found = await placeOf(chatBotId, options);
    const userId = personOf(options);
    const current = await records.control(found.chatBotId);
    if (current?.userId === userId) return { messages: [], control: await named(current, options) };
    await wake(found.chatBotId);
    const changed = await records.giveControl(found.chatBotId, userId);
    if (!changed) throw new AppError(409, `${found.botName}'s computer couldn't start. Try again in a minute.`, { code: "computer_not_started" });
    const names = await chats.names([userId, changed.before?.userId].filter(Boolean), options);
    const control = { ...changed.control, name: names.get(userId) || "Someone" };
    const from = changed.before && changed.before.userId !== userId ? ` from ${names.get(changed.before.userId) || "someone"}` : "";
    const posted = await messages.append(found.chatId, [line(found, `${control.name} took over ${found.botName}'s computer${from}.`, control)], options);
    await tell(found, control, userId, options);
    return { messages: posted, control };
  }

  /**
   * The caller hands the bot's computer back to it, whoever had control. With nobody in control nothing changes:
   * `{ messages: [], control: null }`.
   */
  async function handBack(chatBotId, options) {
    const found = await placeOf(chatBotId, options);
    const userId = personOf(options);
    if (!(await records.control(found.chatBotId))) return { messages: [], control: null };
    const changed = await records.giveControl(found.chatBotId, null);
    if (!changed?.before) return { messages: [], control: null };
    const names = await chats.names([userId], options);
    const posted = await messages.append(found.chatId, [line(found, `${names.get(userId) || "Someone"} handed ${found.botName}'s computer back.`, null)], options);
    await tell(found, null, userId, options);
    return { messages: posted, control: null };
  }

  /**
   * Refused while a person has control of the computer: what the bot is told, naming them, for each thing it would do
   * on it (D16). Read by the computer's id alone, as the bot's calls are made.
   */
  async function heldOff(chatBotId) {
    const control = await records.control(String(chatBotId));
    if (!control) return;
    const found = await directory.computerOf(String(chatBotId), system());
    const names = await chats.names([control.userId], system()).catch(() => new Map());
    const bot = found?.botName || "the bot";
    throw new AppError(409, `${names.get(control.userId) || "A person"} has control of ${bot}'s computer. Wait until they hand it back.`, {
      code: "computer_person_in_control"
    });
  }

  /**
   * Something signed in on the computer (D14, D16): `kind` "site", "coding" or "sedna", `label` what the panel names.
   * Answers the computer's sign-ins, newest first. Its screens hear of it.
   */
  async function noteSignIn(computerId, { label, kind }) {
    if (!SIGN_IN_KINDS.has(kind) || !String(label ?? "").trim()) throw new TypeError("A sign-in has a label and a kind: site, coding or sedna.");
    const listed = await records.noteSignIn(String(computerId), { label: String(label).trim(), kind });
    await notices.publish("computer", String(computerId), {}).catch(() => {});
    return listed;
  }

  /** A fill that typed a password signed in to its site (the site it named, else the page's host). */
  async function filled(computerId, values, result) {
    if (!result?.filled?.includes("password")) return;
    await noteSignIn(computerId, { label: String(values?.site || "").trim() || hostOf(result.url) || "A website", kind: "site" });
  }

  /** The coding tools a coding answer shows signed in, each listed once. */
  async function coded(computerId, result) {
    const signedIn = (result?.tools ?? []).filter((tool) => tool.signedIn).map((tool) => tool.label);
    if (!signedIn.length) return;
    const listed = new Set((await records.signIns(String(computerId))).filter((one) => one.kind === "coding").map((one) => one.label));
    for (const label of signedIn.filter((one) => !listed.has(one))) await noteSignIn(computerId, { label, kind: "coding" });
  }

  return Object.freeze({
    placeOf,
    named,
    takeOver,
    handBack,
    heldOff,
    noteSignIn,
    filled,
    coded
  });
}
