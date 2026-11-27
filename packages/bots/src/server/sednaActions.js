import { readFile } from "node:fs/promises";
import { ConnectedAppError, connectedKey, sendOrSimulate } from "./connectedApps.js";
import { eventMessage } from "./eventMessage.js";
import * as sedna from "./sednaChanges.js";

// Sedna's writes (D-94), each an action that goes through approvals.decide() like every other write: a message sent,
// a draft saved, changed, sent or given an attachment, a tag or job reference put on or taken off a message, a job
// reference made, a message assigned, a contact added or changed. Each runs as the person's own Sedna user, from one of
// their teams, on messages in their teams, found again when it runs (an approval may run later): never another user. It
// works in any chat (D15, R4): the person asks, and their own Sedna user acts. Every one is real only in a live copy:
// Sedna is the organisation's shared mailbox, where a change shows to the whole team at once and can set off its
// workflows, so a test copy connected to a real Sedna logs it instead (sendOrSimulate, D-69), after every check a live
// copy makes.

/** Why the person can't use Sedna, and what they do about it. */
export function nobodyInSedna(who) {
  const fix = "Say so plainly in a line; don't use Sedna another way.";
  if (who.asked) {
    return `The person picked ${who.asked.name} as themselves in Sedna; an owner or admin of the home still has to confirm that in Connect apps (Sedna, People) before their bot uses Sedna. ${fix}`;
  }
  if (who.taken) return `Sedna's user with the person's email address, ${who.taken}, is confirmed for someone else in this home. An owner or admin sorts it out in Connect apps (Sedna, People). ${fix}`;
  if (who.gone) return `The Sedna user confirmed for the person, ${who.gone}, is archived or gone in Sedna. They pick themselves again in Connect apps (Sedna). ${fix}`;
  return "The person isn't matched to a Sedna user: no Sedna user has their email address. They pick themselves in Connect apps (Sedna, " +
    `Who you are in Sedna), and an owner or admin confirms it; until then their bot uses nothing in Sedna. ${fix}`;
}

/** The key and address of a connected Sedna, with a refused key made again once (sednaApi.js). */
export const sednaAccess = ({ integrations, call }, entry) => ({
  api: entry.api,
  key: entry.key,
  renew: async (refused) => (await integrations.connections.accessToken(entry.id, call, { refused })).accessToken
});

/**
 * The home's Sedna for the person an action is for, found when it runs: refused for a person who is no one in Sedna.
 * @param {{ integrations: object, call: object, skip?: string[] }} context
 */
async function sednaFor(context) {
  const entry = await connectedKey(context, "sedna", "Sedna");
  const who = await context.integrations.connections.appPerson(entry.id, context.call);
  if (!who.person) throw new ConnectedAppError(nobodyInSedna(who));
  return { entry, person: who.person, access: sednaAccess(context, entry) };
}

/** How each change reaches Sedna: in a live copy only; a test copy logs it (sednaChanges.js SednaCommit). */
const commitIn = (context) => (effect, act) => sendOrSimulate(context, effect, act, () => ({}));

const ATTACHMENTS_MAX = 5;
/** The bot's files named for attachments, read when the action runs: 5 at most. */
async function botFiles(context, paths = []) {
  if (!paths.length) return [];
  if (paths.length > ATTACHMENTS_MAX) throw new ConnectedAppError(`Attach ${ATTACHMENTS_MAX} files at most to one Sedna message.`);
  if (!context.files || !context.place) throw new ConnectedAppError("The bot's files can't be reached from here. Nothing was sent.");
  return Promise.all(paths.map(async (path) => {
    const file = await context.files.store.existingFile(context.place, path).catch(() => null);
    if (!file) throw new ConnectedAppError(`There's no file ${path} among the bot's files. Nothing was sent.`);
    return { name: String(path).split("/").pop(), bytes: await readFile(file.real) };
  }));
}

const listed = (value) => (Array.isArray(value) ? value.join(", ") : String(value || ""));
const testCopy = (done) => (done.simulated ? " This is a test copy, so it was logged, not done in Sedna." : "");
const NOT_THREADED =
  "Sent as a new message with the answered one quoted: Sedna's API has no field for answering a message, so it may " +
  "show outside that conversation's thread in Sedna.";

/**
 * A message as the person sends it: from their own user and team, to the recipients given, its text as HTML, and for a
 * reply the answered message (read again, in their teams) quoted below.
 */
async function sednaOutgoing(access, person, { team, to, cc, subject, text, replyTo }) {
  const basis = replyTo ? await sedna.replyBasis(access, person, replyTo) : null;
  const chosen = sedna.ownTeam(person, team, basis?.teams || []);
  const message = {
    to: sedna.recipients(to),
    cc: sedna.recipients(cc),
    subject: String(subject ?? basis?.subject ?? "").trim().slice(0, 300),
    html: sedna.messageHtml(text, basis?.quote || null),
    replyTo: basis?.id || ""
  };
  if (!message.to.length) throw new ConnectedAppError("Give the recipients' email addresses in to. Nothing was sent.");
  return { team: chosen, message, basis };
}

/** Sends a message (a card's Send, or sedna_mail.send) as the person; the event line says what went where. */
export async function sendSednaMessage(context, args) {
  const { person, access } = await sednaFor(context);
  const { team, message, basis } = await sednaOutgoing(access, person, args);
  const files = await botFiles(context, args.files);
  const done = await sedna.sendMessage(access, person, team, message, files, commitIn(context));
  const subject = message.subject || "(no subject)";
  return eventMessage(
    `Sent from Sedna: ${subject}`,
    `Sent "${subject}" from ${team.name} in Sedna as ${person.name} to ${message.to.map((entry) => entry.email).join(", ")}` +
      `${files.length ? `, with ${files.map((file) => file.name).join(", ")}` : ""}.${basis ? ` ${NOT_THREADED}` : ""}${testCopy(done)}`,
    { ...done, team: team.name }
  );
}

const sendQuestion = ({ subject, to, team }) => `Shall I send "${subject || "(no subject)"}" to ${listed(to)} from Sedna${team ? ` (${team})` : ""}?`;

/** The actions, by id; each id is also its switch in Connect apps. `asksInRoutines`: a routine's run asks unless a rule allows. */
export const SEDNA_ACTIONS = {
  "sedna_mail.send": {
    reversible: (args) => args.personAsked,
    asksInRoutines: true,
    describe: ({ subject, to, team }) => `send the Sedna message "${subject || "(no subject)"}" to ${listed(to)} from the person's team ${team || ""}`.trim(),
    question: sendQuestion,
    run: sendSednaMessage
  },
  "sedna_mail.save_draft": {
    reversible: () => true,
    describe: ({ subject, to }) => `save the draft "${subject || "(no subject)"}" to ${listed(to)} in the person's Sedna Drafts`,
    question: ({ subject }) => `Shall I save "${subject || "(no subject)"}" in your Sedna Drafts?`,
    async run(context, args) {
      const { person, access } = await sednaFor(context);
      const { team, message } = await sednaOutgoing(access, person, args);
      const files = await botFiles(context, args.files);
      const done = await sedna.createDraft(access, person, team, message, files, commitIn(context));
      const subject = message.subject || "(no subject)";
      return eventMessage(
        `Saved a draft in Sedna: ${subject}`,
        `Saved "${subject}" in ${person.name}'s Sedna Drafts, from ${team.name}${done.id ? ` (draft id ${done.id})` : ""}. Nothing was sent.${testCopy(done)}`,
        { ...done, team: team.name }
      );
    }
  },
  "sedna_mail.update_draft": {
    reversible: () => true,
    describe: ({ id, subject, name }) => `change the person's Sedna draft ${subject || name ? `"${subject || name}"` : id}`,
    question: ({ id, subject, name }) => `Shall I change your Sedna draft ${subject || name ? `"${subject || name}"` : id}?`,
    async run(context, args) {
      const { person, access } = await sednaFor(context);
      const changes = {
        ...(args.to ? { to: sedna.recipients(args.to) } : {}),
        ...(args.cc ? { cc: sedna.recipients(args.cc) } : {}),
        ...(args.subject !== undefined ? { subject: String(args.subject).slice(0, 300) } : {}),
        ...(args.text !== undefined ? { html: sedna.messageHtml(args.text) } : {})
      };
      const done = await sedna.updateDraft(access, person, args.id, changes, commitIn(context));
      return eventMessage(`Changed the Sedna draft: ${done.subject || "(no subject)"}`, `Changed the draft "${done.subject}" (id ${done.id}) in Sedna. Nothing was sent.${testCopy(done)}`, done);
    }
  },
  "sedna_mail.send_draft": {
    reversible: (args) => args.personAsked,
    asksInRoutines: true,
    describe: ({ id, subject }) => `send the person's Sedna draft ${subject ? `"${subject}"` : id}`,
    question: ({ id, subject }) => `Shall I send your Sedna draft ${subject ? `"${subject}"` : id}?`,
    async run(context, args) {
      const { person, access } = await sednaFor(context);
      const done = await sedna.sendDraft(access, person, args.id, args.team, commitIn(context));
      const to = done.to.map((entry) => entry.email).join(", ");
      return eventMessage(`Sent from Sedna: ${done.subject || "(no subject)"}`, `Sent the draft "${done.subject}" from ${done.team} in Sedna${to ? ` to ${to}` : ""}.${testCopy(done)}`, done);
    }
  },
  "sedna_mail.attach": {
    reversible: () => true,
    describe: ({ id, files }) => `attach ${listed(files)} to the person's Sedna draft ${id}`,
    question: ({ files }) => `Shall I attach ${listed(files)} to your Sedna draft?`,
    async run(context, args) {
      const { person, access } = await sednaFor(context);
      const files = await botFiles(context, args.files);
      const done = [];
      for (const file of files) done.push(await sedna.attachFile(access, person, args.id, file, commitIn(context)));
      const subject = done[0]?.subject || "(no subject)";
      return eventMessage(`Attached to the Sedna draft: ${subject}`, `Attached ${files.map((file) => file.name).join(", ")} to the draft "${subject}" in Sedna.${testCopy(done[0] || {})}`, { files: done });
    }
  },
  ...Object.fromEntries(
    [
      ["tag", "tagMessage", false, "put the tag", "on", "Tagged"],
      ["untag", "tagMessage", true, "take the tag", "off", "Took the tag off"],
      ["link_job", "linkJob", false, "link the job reference", "to", "Linked the job reference"],
      ["unlink_job", "linkJob", true, "unlink the job reference", "from", "Unlinked the job reference"]
    ].map(([name, call, remove, verb, preposition, done]) => [
      `sedna_sort.${name}`,
      {
        reversible: () => true,
        describe: ({ subject, tag, job }) => `${verb} ${tag || job} ${preposition} the Sedna message "${subject || ""}"`,
        question: ({ subject, tag, job }) => `Shall I ${verb} ${tag || job} ${preposition} "${subject || "this message"}" in Sedna?`,
        async run(context, args) {
          const { person, access } = await sednaFor(context);
          const result = await sedna[call](access, person, args.id, args.tag || args.job, { remove, commit: commitIn(context) });
          const what = result.tag || result.jobReference;
          return eventMessage(`${done} ${what}: ${result.subject}`, `${done} ${what} ${preposition} "${result.subject}" (message ${result.message}) in Sedna; the team sees it at once.${testCopy(result)}`, result);
        }
      }
    ])
  ),
  "sedna_sort.create_job": {
    reversible: () => true,
    describe: ({ name, team }) => `make the job reference ${name} in Sedna for the person's team ${team || ""}`.trim(),
    question: ({ name }) => `Shall I make the job reference ${name} in Sedna?`,
    async run(context, args) {
      const { person, access } = await sednaFor(context);
      const team = sedna.ownTeam(person, args.team);
      const made = await sedna.createJob(access, person, team, { name: args.name, type: args.type }, commitIn(context));
      return eventMessage(
        made.made ? `Made the job reference ${made.name}` : `Job reference ${made.name} was already there`,
        made.made ? `Made the job reference ${made.name} for ${team.name} in Sedna.${testCopy(made)}` : `Sedna already has the job reference ${made.name} (id ${made.id}); nothing new was made.`,
        made
      );
    }
  },
  "sedna_assign.assign": {
    reversible: (args) => args.personAsked,
    asksInRoutines: true,
    describe: ({ subject, to }) => `assign the Sedna message "${subject || ""}" to ${to}, who Sedna tells`,
    question: ({ subject, to }) => `Shall I assign "${subject || "this message"}" to ${to} in Sedna? Sedna tells them.`,
    async run(context, args) {
      const { person, access } = await sednaFor(context);
      const done = await sedna.assignMessage(access, person, args.id, args.to, commitIn(context));
      return eventMessage(`Assigned to ${done.assignedTo}: ${done.subject}`, `Assigned "${done.subject}" (message ${done.message}) to ${done.assignedTo} in Sedna.${testCopy(done)}`, done);
    }
  },
  "sedna_contacts.create": {
    reversible: () => true,
    describe: ({ firstName, lastName, company }) => `add the contact ${[firstName, lastName].filter(Boolean).join(" ") || company} to Sedna`,
    question: ({ firstName, lastName, company }) => `Shall I add ${[firstName, lastName].filter(Boolean).join(" ") || company} to your Sedna contacts?`,
    async run(context, args) {
      const { person, access } = await sednaFor(context);
      const team = sedna.ownTeam(person, args.team);
      const made = await sedna.createContact(access, person, team, args, commitIn(context));
      return eventMessage(`Added the contact ${made.name}`, `Added ${made.name} to ${team.name}'s contacts in Sedna${made.id ? ` (id ${made.id})` : ""}.${testCopy(made)}`, made);
    }
  },
  "sedna_contacts.update": {
    reversible: () => true,
    describe: ({ id, name }) => `change the Sedna contact ${name || id}`,
    question: ({ id, name }) => `Shall I change the Sedna contact ${name || id}?`,
    async run(context, args) {
      const { person, access } = await sednaFor(context);
      const { id, team: _team, personAsked: _asked, name: _name, ...fields } = args;
      const done = await sedna.updateContact(access, person, id, fields, commitIn(context));
      return eventMessage(`Changed the contact ${done.name}`, `Changed ${done.name} (id ${done.id}) in Sedna's contacts.${testCopy(done)}`, done);
    }
  }
};

// The ids a reply must have called before it may say Sedna was changed or a message sent from it, with its draft card.
export const SEDNA_CHANGES = [...Object.keys(SEDNA_ACTIONS), "sedna_draft"];
