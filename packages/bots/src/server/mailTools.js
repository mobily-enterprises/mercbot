import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { eventMessage } from "./eventMessage.js";
import { connectedKey, connectedKeys, sendOrSimulate } from "./connectedApps.js";
import * as google from "./googleApps.js";
import * as microsoft from "./microsoftApps.js";

// The rest of the person's mailbox (D-42), beyond searching, reading and the draft card:
// who the account is, its labels (Outlook's folders) and filters, drafts saved in the mailbox,
// sorting mail, labels themselves, and forwarding. Each action is its own switch in Connect apps
// ("mail_drafts.send"); a tool offers only the actions still on. Changes go through approvals
// like every other write, and each leaves an event line saying what changed. Sending a draft and
// forwarding go out only in a live copy; a test copy logs them (D-69).
export const MAIL = { gmail: google, outlook: microsoft };

const mailbox = ({ integrations, reach, call }, account) => connectedKey({ integrations, reach, call }, Object.keys(MAIL), "email", account);
const emails = (count) => (count === 1 ? "an email" : `${count} emails`);

const DRAFT_ACTIONS = {
  create: { reversible: () => true, verb: "Saved a draft", ask: "save this draft" },
  update: { reversible: () => true, verb: "Updated the draft", ask: "update the draft" },
  delete: { reversible: (args) => args.personAsked, verb: "Deleted the draft", ask: "delete the draft" },
  send: { reversible: (args) => args.personAsked, verb: "Sent the draft", ask: "send the draft" }
};

// What each way of sorting mail is called, done and undone.
const SORTING = {
  archive: ["Archived", "Moved back to the inbox"],
  bin: ["Moved to the bin", "Taken out of the bin"],
  spam: ["Marked as spam", "Marked as not spam"],
  mark_read: ["Marked as read", "Marked as unread"],
  star: ["Starred", "Unstarred"],
  label: ["Labelled", "Took the label off"],
  move: ["Moved", "Moved back to the inbox"]
};
const sorted = ({ action, undo, label }) => {
  const [done, undone] = SORTING[action];
  if (undo) return action === "label" ? `${undone} ${label}` : undone;
  return action === "label" ? `${done} ${label}` : action === "move" ? `${done} to ${label}` : done;
};

const LABEL_ACTIONS = {
  create: { reversible: () => true },
  rename: { reversible: () => true },
  delete: { reversible: (args) => args.personAsked }
};

export const MAIL_ACTIONS = {
  ...Object.fromEntries(
    Object.entries(DRAFT_ACTIONS).map(([name, spec]) => [
      `mail_drafts.${name}`,
      {
        reversible: spec.reversible,
        describe: ({ subject, to }) =>
          `${spec.ask} "${subject || "(no subject)"}"${to?.length ? ` to ${to.join(", ")}` : ""} in the person's mailbox`,
        question: ({ subject, to }) => `Shall I ${spec.ask} "${subject || "(no subject)"}"${to?.length ? ` to ${to.join(", ")}` : ""}?`,
        async run(context, args) {
          const entry = await mailbox(context, args.account);
          const app = MAIL[entry.pluginId];
          const subject = args.subject || "(no subject)";
          const send = () => sendOrSimulate(
            context,
            {
              kind: "email",
              summary: `the draft "${subject}" from ${entry.account}${args.to?.length ? ` to ${args.to.join(", ")}` : ""}`,
              details: { from: entry.account, draft: args.id, to: args.to || [] }
            },
            () => app.sendDraft(entry.key, args.id)
          );
          const done =
            name === "create"
              ? await app.createDraft(entry.key, args)
              : name === "update"
                ? await app.updateDraft(entry.key, args.id, args)
                : name === "delete"
                  ? await app.deleteDraft(entry.key, args.id)
                  : await send();
          const id = done?.id ? ` ${name === "send" ? "Sent message" : "Draft"} id ${done.id}.` : "";
          return eventMessage(
            `${spec.verb}: ${subject}`,
            `${spec.verb} "${subject}" in ${entry.account}${name === "send" && args.to?.length ? `, to ${args.to.join(", ")}` : ""}.${id}`,
            done || {}
          );
        }
      }
    ])
  ),
  ...Object.fromEntries(
    Object.keys(SORTING).map((name) => [
      `organise_email.${name}`,
      {
        reversible: () => true,
        describe: (args) => `${sorted(args).toLowerCase()}: ${emails(args.ids.length)} in the person's mailbox`,
        question: (args) => `Shall I do this to ${emails(args.ids.length)}: ${sorted(args).toLowerCase()}?`,
        async run(context, args) {
          const entry = await mailbox(context, args.account);
          const ids = [];
          for (const id of args.ids) ids.push((await MAIL[entry.pluginId].organiseEmail(entry.key, id, args)).id);
          const said = sorted(args);
          return eventMessage(
            `${said}: ${emails(ids.length)}`,
            `${said}: ${emails(ids.length)} in ${entry.account}. Their ids now: ${ids.join(", ")}.`,
            { ids }
          );
        }
      }
    ])
  ),
  ...Object.fromEntries(
    Object.entries(LABEL_ACTIONS).map(([name, spec]) => [
      `mail_labels.${name}`,
      {
        reversible: spec.reversible,
        describe: ({ name: label, newName }) => `${name} the mail label "${label}"${newName ? ` as "${newName}"` : ""}`,
        question: ({ name: label, newName }) => `Shall I ${name} the label "${label}"${newName ? ` to "${newName}"` : ""}?`,
        async run(context, args) {
          const entry = await mailbox(context, args.account);
          const app = MAIL[entry.pluginId];
          if (name === "create") {
            await app.createLabel(entry.key, args.name);
          } else if (name === "rename") {
            await app.renameLabel(entry.key, args.name, args.newName);
          } else {
            await app.deleteLabel(entry.key, args.name);
          }
          const text = {
            create: `Made the label ${args.name}`,
            rename: `Renamed the label ${args.name} to ${args.newName}`,
            delete: `Deleted the label ${args.name}`
          }[name];
          const kept =
            name === "delete"
              ? entry.pluginId === "outlook"
                ? " The folder and its mail went to Deleted Items."
                : " Its emails keep everything but the label."
              : "";
          return eventMessage(text, `${text} in ${entry.account}.${kept}`, {});
        }
      }
    ])
  ),
  forward_email: {
    reversible: (args) => args.personAsked,
    describe: ({ to }) => `forward an email to ${to.join(", ")} as the person`,
    question: ({ to, note }) =>
      `Shall I forward this email to ` +
      `${to.join(", ")}${note ? ` with the note "${note.length > 200 ? `${note.slice(0, 200)}…` : note}"` : ""}?`,
    async run(context, args) {
      const entry = await mailbox(context, args.account);
      const app = MAIL[entry.pluginId];
      const sent = await sendOrSimulate(
        context,
        {
          kind: "email",
          summary: `the forward of an email from ${entry.account} to ${args.to.join(", ")}`,
          details: { from: entry.account, email: args.id, to: args.to }
        },
        () => app.forwardEmail(entry.key, args.id, args),
        // The email it would forward, read as a real forward reads it.
        async () => ({ subject: (await app.readEmail(entry.key, args.id)).subject })
      );
      const left = sent.attachmentsLeftOut ? " Its attachments weren't included." : "";
      return eventMessage(
        `Forwarded: ${sent.subject}`,
        `Forwarded "${sent.subject}" from ${entry.account} to ${args.to.join(", ")}.${left}`,
        sent
      );
    }
  }
};

// The ids a reply must have called before it may say mail was changed or sent.
export const MAIL_CHANGES = Object.keys(MAIL_ACTIONS);

/**
 * The mail tools, given what they share with the other connected-account tools in accountTools.
 * @param {object} shared
 * @param {import("./types.js").AppFor} shared.appFor
 * @param {import("./types.js").AttemptAction} shared.attempt
 * @param {string[]} shared.removed
 * @param {import("./types.js").ToolFailure} shared.failed
 * @param {import("./types.js").AccountField} shared.account
 * @param {import("zod").ZodType} shared.statusLine
 * @param {import("zod").ZodType} shared.personAsked
 */
export function buildMailTools({ appFor, attempt, removed, failed, account, statusLine, personAsked }) {
  const tools = {};
  /** The actions of a grouped tool that are still on somewhere. */
  const on = (toolId, names) => names.filter((name) => !removed.includes(`${toolId}.${name}`));
  const recipients = z.array(z.string().email()).max(20);

  const infoActions = on("mail_account", ["whoami", "labels", "filters"]);
  if (infoActions.length) {
    async function mailAccount({ action, account: wanted }) {
      try {
        const call = { whoami: "mailAccount", labels: "mailLabels", filters: "mailFilters" }[action];
        const accounts = await connectedKeys(appFor(`mail_account.${action}`), Object.keys(MAIL), "email", wanted);
        return {
          mailboxes: await Promise.all(
            accounts.map(async (entry) => ({ account: entry.account, [action]: await MAIL[entry.pluginId][call](entry.key) }))
          )
        };
      } catch (error) {
        return failed(error);
      }
    }
    tools.mailAccount = createTool(
      Object.freeze({
        id: "mail_account",
        description:
          "About the person's connected mailboxes (every one unless you name one): whoami gives the address and the addresses it can send as; labels lists its labels (Outlook: folders) with their ids; filters lists Gmail's filters.",
        inputSchema: z.object({ action: z.enum(infoActions), account: account("One mailbox, by address or label; leave out for all") }),
        execute: (input, options) => mailAccount(input, options)
      })
    );
  }

  const draftActions = on("mail_drafts", ["list", "read", "create", "update", "delete", "send"]);
  if (draftActions.length) {
    async function mailDrafts({ action, acknowledgement, account: wanted, ...input }) {
      try {
        const entry = await connectedKey(appFor(`mail_drafts.${action}`), Object.keys(MAIL), "email", wanted);
        const app = MAIL[entry.pluginId];
        if (action === "list") return { account: entry.account, drafts: await app.listDrafts(entry.key) };
        if (action !== "create" && !input.id) return { error: "Give the draft's id; list shows them." };
        if (action === "read") return { account: entry.account, draft: await app.readDraft(entry.key, input.id) };
        // A draft's own subject and recipients name it on the card and in the event line.
        const known = action === "create" ? {} : await app.readDraft(entry.key, input.id);
        const split = (value) => String(value || "").split(",").map((part) => part.trim()).filter(Boolean);
        const args = {
          ...input,
          subject: input.subject ?? known.subject,
          to: input.to || split(known.to),
          account: entry.account,
          personAsked: Boolean(input.personAsked)
        };
        return await attempt(`mail_drafts.${action}`, args, acknowledgement);
      } catch (error) {
        return failed(error);
      }
    }
    tools.mailDrafts = createTool(
      Object.freeze({
        id: "mail_drafts",
        description:
          "Drafts saved in the person's mailbox itself (Gmail or Outlook's Drafts), not the draft card in this chat: list, read, create, update (only what you give changes), delete, or send one. To write something for the person to check and send, use show_draft instead; use these when they ask about the drafts in their mailbox. Sending or deleting needs the person to have asked for exactly that.",
        inputSchema: z.object({
          action: z.enum(draftActions),
          acknowledgement: statusLine,
          account: account("The mailbox, by address or label; needed when several are connected"),
          id: z.string().max(500).optional().describe("The draft's id, from list (for read, update, delete, send)"),
          to: recipients.optional().describe("Recipients' email addresses"),
          cc: recipients.optional(),
          subject: z.string().max(300).optional(),
          text: z.string().max(20000).optional().describe("The whole message text, plain"),
          personAsked
        }),
        execute: (input, options) => mailDrafts(input, options)
      })
    );
  }

  const sortActions = on("organise_email", Object.keys(SORTING));
  if (sortActions.length) {
    async function organiseEmail({ action, acknowledgement, ids, undo, label, account: wanted }) {
      try {
        if ((action === "label" || action === "move") && !label && !(action === "move" && undo)) {
          return { error: "Say which label or folder in label." };
        }
        const entry = await connectedKey(appFor(`organise_email.${action}`), Object.keys(MAIL), "email", wanted);
        return await attempt(
          `organise_email.${action}`,
          { action, ids, undo: Boolean(undo), label, account: entry.account },
          acknowledgement
        );
      } catch (error) {
        return failed(error);
      }
    }
    tools.organiseEmail = createTool(
      Object.freeze({
        id: "organise_email",
        description:
          "Sort one or more emails in a connected mailbox, by the ids search_email gave: archive, bin (to the bin), spam, mark_read, star (Outlook: flag), label (Gmail label; Outlook category), move (to a label or folder by name). With undo, the reverse: back to the inbox, out of the bin, not spam, unread, unstarred, label off. All of these can be undone.",
        inputSchema: z.object({
          action: z.enum(sortActions),
          acknowledgement: statusLine,
          ids: z.array(z.string().min(5).max(500)).min(1).max(25),
          undo: z.boolean().optional(),
          label: z.string().max(200).optional().describe("For label and move: the label's or folder's name"),
          account: account("The mailbox the emails are in, by address or label; needed when several are connected")
        }),
        execute: (input, options) => organiseEmail(input, options)
      })
    );
  }

  const labelActions = on("mail_labels", Object.keys(LABEL_ACTIONS));
  if (labelActions.length) {
    async function mailLabels({ action, acknowledgement, account: wanted, ...input }) {
      try {
        if (action === "rename" && !input.newName) return { error: "Give the new name in newName." };
        const entry = await connectedKey(appFor(`mail_labels.${action}`), Object.keys(MAIL), "email", wanted);
        return await attempt(
          `mail_labels.${action}`,
          { ...input, account: entry.account, personAsked: Boolean(input.personAsked) },
          acknowledgement
        );
      } catch (error) {
        return failed(error);
      }
    }
    tools.mailLabels = createTool(
      Object.freeze({
        id: "mail_labels",
        description:
          "Make, rename or delete a label in a connected mailbox (Outlook: a folder). Deleting needs the person to have asked for exactly that.",
        inputSchema: z.object({
          action: z.enum(labelActions),
          acknowledgement: statusLine,
          name: z.string().min(1).max(200).describe("The label's name (for rename and delete, its current name)"),
          newName: z.string().min(1).max(200).optional().describe("For rename"),
          account: account("The mailbox, by address or label; needed when several are connected"),
          personAsked
        }),
        execute: (input, options) => mailLabels(input, options)
      })
    );
  }

  async function forwardEmail({ acknowledgement, account: wanted, ...input }) {
    try {
      const entry = await connectedKey(appFor("forward_email"), Object.keys(MAIL), "email", wanted);
      return await attempt("forward_email", { ...input, account: entry.account, personAsked: Boolean(input.personAsked) }, acknowledgement);
    } catch (error) {
      return failed(error);
    }
  }
  tools.forwardEmail = createTool(
    Object.freeze({
      id: "forward_email",
      description:
        "Forward an email from a connected mailbox, by the id search_email gave, to other addresses with a short note from the person. It goes out as the person, so it needs them to have asked for exactly this, recipients included.",
      inputSchema: z.object({
        acknowledgement: statusLine,
        id: z.string().min(5).max(500),
        to: recipients.min(1),
        note: z.string().max(4000).optional().describe("A short note above the forwarded email, in the person's voice"),
        account: account("The mailbox it's in, by address or label; needed when several are connected"),
        personAsked
      }),
      execute: (input, options) => forwardEmail(input, options)
    })
  );

  return tools;
}
