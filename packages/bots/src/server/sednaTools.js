import { createTool } from "@jskit-ai/agent/server";
import { z } from "zod";
import { ConnectedAppError, connectedKey } from "./connectedApps.js";
import { nobodyInSedna, sednaAccess } from "./sednaActions.js";
import {
  DOWNLOAD_MAX_BYTES,
  FEED_MESSAGES,
  UPLOAD_MAX_BYTES,
  downloadDocument,
  feedSince,
  listContacts,
  listJobs,
  listTags,
  listTeams,
  listTemplates,
  messageDocuments,
  messagesByJob,
  messagesByTag,
  ownMessage,
  readContact,
  readMessage,
  readTemplate,
  recentMessages
} from "./sednaApi.js";
import { JOB_TYPES, ownDraft, ownTeam, recipients, replyBasis } from "./sednaChanges.js";

// The home's Sedna (D-93, D-94), used for the person who asks: only what their own Sedna user's teams see (sednaApi.js),
// and only in their own chat with their bot, where nobody else reads the answer. Who they are in Sedna is integrations'
// (appPeople.js): their address, or the user they picked and an owner or admin confirmed. Reads answer at once; every
// change in Sedna is an action (sednaActions.js) that goes through approvals, real only in a live copy; a message to
// send is a draft card first, sent when the person presses Send. Each action is its own switch in Connect apps
// ("sedna_messages.read", "sedna_mail.send").

export const SEDNA_READS = Object.freeze({
  sedna_messages: ["recent", "by_tag", "by_job", "read"],
  sedna_lists: ["tags", "jobs", "teams", "contacts", "contact", "templates", "template"],
  sedna_attachments: ["list", "save", "save_all"]
});
export const SEDNA_WRITES = Object.freeze({
  sedna_mail: ["send", "save_draft", "update_draft", "send_draft", "attach"],
  sedna_sort: ["tag", "untag", "link_job", "unlink_job", "create_job"],
  sedna_assign: ["assign"],
  sedna_contacts: ["create", "update"]
});

const DESCRIPTIONS = {
  sedna_messages:
    "Read the home's Sedna, the shared email of the person's teams: recent gives the newest messages that came into the person's " +
    "teams (since: a date or time); by_tag the newest with a tag (tag: its name or id); by_job the newest linked to a job " +
    "reference (job: its name, e.g. a voyage or deal number, or id); read one message by its id (id, from a list): who sent it " +
    "to whom, its text, its tags and job references, who it's assigned to, the team's comments and its attachments. Only the " +
    "person's own teams' messages can be read. Comments are read only: Sedna's API can't add one to a message.",
  sedna_lists:
    "Sedna's lists for the person's teams (reads only): tags, jobs (job references, newest first), teams (the person's own, the only " +
    "inboxes used), contacts (the teams' shared contacts), contact (one by id, in full), templates (the teams' message templates) " +
    "and template (one by id: its subject and text). words narrows tags, jobs, contacts and templates by name.",
  sedna_attachments:
    "A Sedna message's attachments (the message in the person's teams, by its id): list them, save one (document: its id or name " +
    "from list) or save_all into your files, under /files/mine/Sedna/. 25 MB each at most; save_all saves 10 files, 60 MB in all, " +
    "and says what it left.",
  sedna_mail:
    "Send from Sedna as the person, from one of their teams, or work on their own Sedna drafts. To write something for them to " +
    "check and send, use sedna_draft (a card) instead; use these only when they ask in so many words. send: a new message now " +
    "(to, subject, text; replyTo answers a message, quoting it); save_draft: put a message in their Sedna Drafts without sending " +
    "it; update_draft: change one of their own drafts (id; only what you give changes); send_draft: send one of their own " +
    "drafts (id); attach: add files of yours (attach: their paths) to one of their own drafts. Sending needs the person to have " +
    "asked for exactly that. Sedna's API has no reply field: a reply goes out as a new message, which may show outside the " +
    "conversation's thread in Sedna; say so.",
  sedna_sort:
    "Sort a Sedna message in the person's teams (id: the message's): tag or untag (tag: its name or id), link_job or unlink_job " +
    "(job: a job reference's name or id), and create_job (name, type, team) to make a job reference, only when the person asked " +
    "for a new one in so many words. The team sees every change at once.",
  sedna_assign:
    "Assign a Sedna message in the person's teams (id) to a colleague in its team (to: their name or email address, or me); Sedna " +
    "tells them. It asks first unless the person asked in so many words or a rule allows it. Sedna's API can't take an assignment " +
    "off: the person does that in Sedna.",
  sedna_contacts:
    "Add a contact for one of the person's teams (create: firstName, lastName, company, title, emails, phones, address1, city, " +
    "postalCode, country, team) or change one of their teams' contacts (update: id, and only what changes), only when the " +
    "person asked for exactly that.",
  sedna_inbox:
    "The new messages that came into the person's Sedna teams since this routine last looked (new): oldest first, up to " +
    `${FEED_MESSAGES} a run. When more says so, there are more: say so, and the next run carries on from them.`
};

const SAVE_ALL_FILES = 10;
const SAVE_ALL_BYTES = 60 * 1024 * 1024;
/** A file or folder name from Sedna, safe among the bot's files. */
const safeName = (name, fallback) =>
  String(name || "").replace(/[\p{Cc}/\\:*?"<>|]+/gu, " ").replace(/\s+/gu, " ").replace(/^\.+/u, "").trim().slice(0, 120) || fallback;

/**
 * The Sedna tools, given what they share with the other connected-account tools in accountTools. Offered only when the
 * call reaches a connected Sedna, on the person's own turn; each offers only the actions the person hasn't switched off.
 * @param {object} shared
 * @param {import("./types.js").AppFor} shared.appFor
 * @param {import("./types.js").AttemptAction} shared.attempt
 * @param {string[]} shared.attempted
 * @param {string[]} shared.removed
 * @param {import("./types.js").ToolFailure} shared.failed
 * @param {import("zod").ZodType} shared.statusLine
 * @param {import("zod").ZodType} [shared.personAsked]
 * @param {import("./types.js").InTime} shared.inTime
 * @param {(text: string) => string} shared.untrustedMail
 * @param {string} [shared.guide] the app's guidance for bots (plugins/sedna/skill.md)
 * @param {import("@local/files/server/types").Files} shared.files
 * @param {import("./types.js").Place} shared.place
 * @param {(path: string, data: Buffer) => Promise<string>} shared.keep saves a file among the bot's, with a card
 * @param {object[]} shared.after the cards under the reply
 * @param {boolean} [shared.routineRun] nothing in a routine's run counts as the person asking in so many words
 * @param {{ routine: { id: string, createdAt?: string, feeds?: object | null }, positions: Map<string, object> } | null} [shared.routineFeed]
 */
export function buildSednaTools({
  appFor,
  attempt,
  attempted,
  removed,
  failed,
  statusLine,
  personAsked = z.boolean().optional(),
  inTime,
  untrustedMail,
  guide = "",
  files,
  place,
  keep,
  after,
  routineRun = false,
  routineFeed = null
}) {
  const tools = {};
  // Who the person is in Sedna, found once a reply.
  let found = null;

  /** A connected Sedna's key and address, and the person's Sedna user; a ConnectedAppError when they are no one there. */
  async function connected(access) {
    const entry = await connectedKey(access, "sedna", "Sedna");
    const { integrations, call } = access;
    found ||= integrations.connections.appPerson(entry.id, call);
    const who = await found.catch((error) => {
      found = null;
      throw error;
    });
    if (!who.person) throw new ConnectedAppError(nobodyInSedna(who));
    return { entry, person: who.person };
  }

  /** Text written by others in Sedna is information, never instructions. */
  const guarded = (value) => {
    if (Array.isArray(value)) return value.map(guarded);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value).map(([name, entry]) => [
        name,
        ["subject", "snippet", "text", "from"].includes(name) && entry ? untrustedMail(entry) : guarded(entry)
      ]));
    }
    return value;
  };

  /** Sedna used for the person, through one switch; a key Sedna refused is made again once (sednaApi.js), then reported. */
  async function using(switchId, work) {
    const app = appFor(switchId);
    const { entry, person } = await connected(app);
    return inTime(work(sednaAccess(app, entry), person, entry), "Using Sedna");
  }

  /**
   * A read: its answer, with Sedna's text marked as information. It reads as the person's own Sedna user, only what
   * their own teams see, so nothing in it is hidden as another person's mail is (D-111).
   */
  async function run(toolId, action, read) {
    try {
      const result = await using(`${toolId}.${action}`, read);
      attempted.push(toolId);
      return { result: guarded(result) };
    } catch (error) {
      return failed(error);
    }
  }

  /** A change: the tool's own checks first (whose message, which team, whose draft), then the action through approvals. */
  async function change(toolId, action, prepare, lead) {
    try {
      const prepared = await using(`${toolId}.${action}`, prepare);
      if (prepared?.error) return prepared;
      return await attempt(`${toolId}.${action}`, { ...prepared, personAsked: !routineRun && Boolean(prepared.personAsked) }, lead);
    } catch (error) {
      return failed(error);
    }
  }

  const actionsOf = (toolId) => (SEDNA_READS[toolId] || SEDNA_WRITES[toolId]).filter((name) => !removed.includes(`${toolId}.${name}`));
  // The app's guidance goes with the first Sedna tool offered, once, not with each.
  let guided = !guide;
  const describe = (toolId) => {
    if (guided) return DESCRIPTIONS[toolId];
    guided = true;
    return `${DESCRIPTIONS[toolId]}\n${guide}`;
  };
  const writing = "Write as the person writes: if they have a skill on their writing style (such as my-writing-style), follow it.";

  /** The bot's files named for attachments: each there, and small enough to add; what's wrong, or "". */
  async function checkedAttachments(paths = []) {
    if (!paths.length) return "";
    if (paths.length > 5) return "Attach 5 files at most to one Sedna message.";
    for (const path of paths) {
      const file = files && place ? await files.store.existingFile(place, path).catch(() => null) : null;
      if (!file) return `There's no file ${path} among your files.`;
      if (file.stat.size > UPLOAD_MAX_BYTES) return `${path} is over 10 MB; attachments added from here are 10 MB at most.`;
    }
    return "";
  }

  const messages = actionsOf("sedna_messages");
  if (messages.length) {
    tools.sednaMessages = createTool(Object.freeze({
      id: "sedna_messages",
      description: describe("sedna_messages"),
      inputSchema: z.object({
        action: z.enum(messages),
        acknowledgement: statusLine,
        id: z.string().max(20).optional().describe("A message's id, from a list (read)"),
        tag: z.string().max(200).optional().describe("A tag's name or id (by_tag)"),
        job: z.string().max(200).optional().describe("A job reference's name or id (by_job)"),
        since: z.string().max(30).optional().describe("recent: e.g. 2026-11-19 or 2026-11-19T08:00:00Z"),
        limit: z.number().int().min(1).max(25).optional().describe("How many messages, 10 unless asked")
      }),
      execute: ({ action, id, tag, job, since, limit = 10 }) => run("sedna_messages", action, (access, person) => {
        if (action === "recent") return recentMessages(access, person, { limit, since });
        if (action === "by_tag") return messagesByTag(access, person, tag, { limit });
        if (action === "by_job") return messagesByJob(access, person, job, { limit });
        return readMessage(access, person, id);
      })
    }));
  }
  const lists = actionsOf("sedna_lists");
  if (lists.length) {
    tools.sednaLists = createTool(Object.freeze({
      id: "sedna_lists",
      description: describe("sedna_lists"),
      inputSchema: z.object({
        action: z.enum(lists),
        acknowledgement: statusLine,
        words: z.string().max(200).optional().describe("Words in the name (tags, jobs, contacts, templates)"),
        id: z.string().max(20).optional().describe("A contact's or template's id (contact, template)")
      }),
      execute: ({ action, words = "", id }) => run("sedna_lists", action, (access, person) => {
        if (action === "tags") return listTags(access, person, words);
        if (action === "jobs") return listJobs(access, person, words);
        if (action === "teams") return listTeams(person);
        if (action === "contact") return readContact(access, person, id);
        if (action === "templates") return listTemplates(access, person, words);
        if (action === "template") return readTemplate(access, person, id);
        return listContacts(access, person, words);
      })
    }));
  }

  const attachments = actionsOf("sedna_attachments");
  if (attachments.length) {
    /** Saves attachments into the bot's files: what was saved, and what was left with why, never silently. */
    async function save(access, listed, chosen) {
      const folder = `/files/mine/Sedna/${safeName(listed.subject, `message ${listed.message}`)}`;
      const saved = [];
      const left = [];
      let bytes = 0;
      for (const document of chosen) {
        if (saved.length >= SAVE_ALL_FILES || bytes + document.size > SAVE_ALL_BYTES) {
          left.push({ name: document.name, why: `past one call's ${SAVE_ALL_FILES} files or 60 MB: save it on its own` });
          continue;
        }
        if (document.size > DOWNLOAD_MAX_BYTES) {
          left.push({ name: document.name, why: "over 25 MB" });
          continue;
        }
        try {
          const data = await downloadDocument(access, document);
          bytes += data.length;
          saved.push(await keep(`${folder}/${safeName(document.name, `attachment ${document.id}`)}`, data));
        } catch (error) {
          if (!(error instanceof ConnectedAppError)) throw error;
          left.push({ name: document.name, why: error.message });
        }
      }
      return { saved, ...(left.length ? { left } : {}), note: "Each saved file shows as a card under your reply." };
    }
    tools.sednaAttachments = createTool(Object.freeze({
      id: "sedna_attachments",
      description: describe("sedna_attachments"),
      inputSchema: z.object({
        action: z.enum(attachments),
        acknowledgement: statusLine,
        id: z.string().max(20).describe("The message's id"),
        document: z.string().max(300).optional().describe("save: the attachment's id or name, from list")
      }),
      execute: ({ action, id, document }) => run("sedna_attachments", action, async (access, person) => {
        const listed = await messageDocuments(access, person, id);
        if (action === "list") return listed;
        if (action === "save_all") return save(access, listed, listed.documents);
        const wanted = String(document || "").trim().toLowerCase();
        const chosen = listed.documents.filter((entry) => entry.id === wanted || entry.name.toLowerCase() === wanted);
        if (chosen.length !== 1) {
          throw new ConnectedAppError(`Say which attachment by its id or name: ${listed.documents.map((entry) => `${entry.name} (${entry.id})`).join("; ") || "it has none"}.`);
        }
        return save(access, listed, chosen);
      })
    }));
  }

  // A message for the person to check and send: a draft card, sent as them from Sedna when they press Send (D-94).
  if (!removed.includes("sedna_draft")) {
    async function sednaDraft({ replyTo, template, team, to, cc, subject, text, attach = [] }) {
      const most = routineRun ? FEED_MESSAGES : 1;
      if (after.filter((message) => message.kind === "draft").length >= most) {
        return routineRun ? { error: `This run already wrote ${most} drafts; the rest wait for the next run.` } : { status: "already shown" };
      }
      try {
        const missing = await checkedAttachments(attach);
        if (missing) return { error: missing };
        const { basis, filled, chosen, person } = await using("sedna_draft", async (access, person) => {
          const basis = replyTo ? await replyBasis(access, person, replyTo) : null;
          const filled = template ? await readTemplate(access, person, template) : null;
          return { basis, filled, chosen: ownTeam(person, team, basis?.teams || []), person };
        });
        const toLine = String(to || basis?.to || "").trim();
        if (!recipients(toLine).length) return { error: "Say who it's for in to, with their email addresses." };
        const body = {
          from: `${person.name} · ${chosen.name} (Sedna)`,
          to: toLine,
          ...(cc ? { cc: String(cc).trim() } : {}),
          subject: String(subject ?? basis?.subject ?? filled?.subject ?? "").trim().slice(0, 200),
          text: String(text || filled?.text || "").trim().slice(0, 8000),
          status: "pending",
          ...(basis ? { inReplyTo: { id: basis.id, subject: basis.original, from: basis.from } } : {}),
          sedna: {
            team: chosen,
            ...(basis ? { replyTo: basis.id } : {}),
            ...(attach.length ? { files: attach } : {}),
            ...(filled ? { template: filled.name } : {})
          }
        };
        if (!body.text) return { error: "Write the message in text." };
        after.push({ kind: "draft", role: "bot", body });
        attempted.push("sedna_draft");
        return {
          status: "waiting_for_send",
          from: body.from,
          to: body.to,
          note:
            "The draft card is below; nothing has been sent. In a short message say who it goes to, from which team, and that they " +
            "can press Send (or tell you to send it)." +
            (basis ? " Say that it goes out as a new message with theirs quoted, which may show outside that conversation's thread in Sedna." : "") +
            (routineRun ? " It waits for the person: a routine never sends it." : "")
        };
      } catch (error) {
        return failed(error);
      }
    }
    tools.sednaDraft = createTool(Object.freeze({
      id: "sedna_draft",
      description:
        "Write a Sedna message for the person to send as themselves from one of their teams, on an editable card with Send and " +
        "Discard; nothing goes out until they press Send or tell you to send it (send_draft). replyTo answers a message by its " +
        "id: To is its sender, the subject gets Re:, and the message is quoted below the text when it's sent. template starts " +
        "from one of the teams' templates (sedna_lists templates). team: which of their teams it comes from, when they have " +
        `several. attach: your files to send with it. ${writing}`,
      inputSchema: z.object({
        replyTo: z.string().max(20).optional().describe("The id of the Sedna message being answered"),
        template: z.string().max(20).optional().describe("A template's id, to start from"),
        team: z.string().max(200).optional().describe("The person's team it comes from, by name or id"),
        to: z.string().max(400).optional().describe("Recipients' email addresses; for a reply, leave out to answer the sender"),
        cc: z.string().max(400).optional().describe("Email addresses to copy in, only when the person asked"),
        subject: z.string().max(200).optional(),
        text: z.string().max(8000).optional().describe("The message, starting with a greeting by first name and ending with a sign-off"),
        attach: z.array(z.string().min(8).max(500)).max(5).optional().describe("Your files to attach (/files/mine/…)")
      }),
      execute: (input) => sednaDraft(input)
    }));
  }

  const mail = actionsOf("sedna_mail");
  if (mail.length) {
    tools.sednaMail = createTool(Object.freeze({
      id: "sedna_mail",
      description: `${describe("sedna_mail")} ${writing}`,
      inputSchema: z.object({
        action: z.enum(mail),
        acknowledgement: statusLine,
        id: z.string().max(20).optional().describe("A draft's id (update_draft, send_draft, attach)"),
        replyTo: z.string().max(20).optional().describe("send, save_draft: the id of the message being answered"),
        team: z.string().max(200).optional().describe("The person's team it comes from, by name or id"),
        to: z.string().max(400).optional().describe("Recipients' email addresses"),
        cc: z.string().max(400).optional(),
        subject: z.string().max(300).optional(),
        text: z.string().max(20000).optional().describe("The whole message text, plain"),
        attach: z.array(z.string().min(8).max(500)).max(5).optional().describe("Your files to attach (/files/mine/…)"),
        personAsked
      }),
      execute: ({ action, acknowledgement, id, replyTo, team, to, cc, subject, text, attach = [], personAsked: asked }) =>
        change("sedna_mail", action, async (access, person) => {
          const missing = await checkedAttachments(attach);
          if (missing) return { error: missing };
          if (action === "send" || action === "save_draft") {
            if (!text) return { error: "Write the message in text." };
            const basis = replyTo ? await replyBasis(access, person, replyTo) : null;
            const chosen = ownTeam(person, team, basis?.teams || []);
            const toLine = String(to || basis?.to || "").trim();
            if (!recipients(toLine).length) return { error: "Say who it's for in to, with their email addresses." };
            return {
              team: chosen.name,
              to: toLine,
              ...(cc ? { cc } : {}),
              subject: subject ?? basis?.subject ?? "",
              text,
              ...(basis ? { replyTo: basis.id } : {}),
              ...(attach.length ? { files: attach } : {}),
              personAsked: asked
            };
          }
          if (!id) return { error: "Give the draft's id." };
          const draft = await ownDraft(access, person, id);
          const named = String(draft.attributes?.subject || "");
          if (action === "attach") {
            if (!attach.length) return { error: "Say which of your files to attach, in attach." };
            return { id: String(draft.id), subject: named, files: attach, personAsked: asked };
          }
          if (action === "send_draft") return { id: String(draft.id), subject: named, ...(team ? { team } : {}), personAsked: asked };
          return {
            id: String(draft.id),
            ...(subject !== undefined ? { subject } : { name: named }),
            ...(to ? { to } : {}),
            ...(cc ? { cc } : {}),
            ...(text !== undefined ? { text } : {}),
            personAsked: asked
          };
        }, acknowledgement)
    }));
  }

  const sort = actionsOf("sedna_sort");
  if (sort.length) {
    tools.sednaSort = createTool(Object.freeze({
      id: "sedna_sort",
      description: describe("sedna_sort"),
      inputSchema: z.object({
        action: z.enum(sort),
        acknowledgement: statusLine,
        id: z.string().max(20).optional().describe("The message's id (tag, untag, link_job, unlink_job)"),
        tag: z.string().max(200).optional(),
        job: z.string().max(200).optional(),
        name: z.string().max(200).optional().describe("create_job: the new job reference's name"),
        type: z.enum(JOB_TYPES).optional().describe("create_job: its type"),
        team: z.string().max(200).optional().describe("create_job: the person's team it's for"),
        personAsked
      }),
      execute: ({ action, acknowledgement, id, tag, job, name, type, team, personAsked: asked }) =>
        change("sedna_sort", action, async (access, person) => {
          if (action === "create_job") {
            if (routineRun || !asked) return { error: "A job reference is made only when the person asks for a new one in so many words. Offer it instead." };
            if (!name) return { error: "Give the new job reference's name." };
            return { name, ...(type ? { type } : {}), team: ownTeam(person, team).name, personAsked: true };
          }
          const isJob = action.endsWith("job");
          if (!(isJob ? job : tag)) return { error: `Say which ${isJob ? "job reference" : "tag"}.` };
          const message = await ownMessage(access, person, id);
          return { id: String(message.id), subject: String(message.attributes?.subject || ""), ...(isJob ? { job } : { tag }), personAsked: asked };
        }, acknowledgement)
    }));
  }

  const assign = actionsOf("sedna_assign");
  if (assign.length) {
    tools.sednaAssign = createTool(Object.freeze({
      id: "sedna_assign",
      description: describe("sedna_assign"),
      inputSchema: z.object({
        action: z.enum(assign),
        acknowledgement: statusLine,
        id: z.string().max(20).describe("The message's id"),
        to: z.string().min(1).max(200).describe("The colleague's name or email address, or me"),
        personAsked
      }),
      execute: ({ action, acknowledgement, id, to, personAsked: asked }) =>
        change("sedna_assign", action, async (access, person) => {
          const message = await ownMessage(access, person, id);
          return { id: String(message.id), subject: String(message.attributes?.subject || ""), to, personAsked: asked };
        }, acknowledgement)
    }));
  }

  const contacts = actionsOf("sedna_contacts");
  if (contacts.length) {
    tools.sednaContacts = createTool(Object.freeze({
      id: "sedna_contacts",
      description: describe("sedna_contacts"),
      inputSchema: z.object({
        action: z.enum(contacts),
        acknowledgement: statusLine,
        id: z.string().max(20).optional().describe("update: the contact's id"),
        team: z.string().max(200).optional().describe("create: the person's team it's for"),
        firstName: z.string().max(200).optional(),
        lastName: z.string().max(200).optional(),
        company: z.string().max(200).optional(),
        title: z.string().max(200).optional(),
        emails: z.array(z.string().email()).max(10).optional(),
        phones: z.array(z.string().max(40)).max(10).optional(),
        address1: z.string().max(200).optional(),
        city: z.string().max(200).optional(),
        postalCode: z.string().max(40).optional(),
        country: z.string().max(100).optional(),
        personAsked
      }),
      execute: ({ action, acknowledgement, id, team, personAsked: asked, ...fields }) =>
        change("sedna_contacts", action, async (access, person) => {
          if (routineRun || !asked) return { error: "Sedna's contacts are added or changed only when the person asks for exactly that. Offer it instead." };
          if (action === "create") return { ...fields, team: ownTeam(person, team).name, personAsked: true };
          const contact = await readContact(access, person, id);
          return { ...fields, id: contact.id, name: contact.name, personAsked: true };
        }, acknowledgement)
    }));
  }

  // A routine's run reads the new mail of the person's teams from Sedna's events feed, from where its last good run got to.
  if (routineFeed && !removed.includes("sedna_inbox.new")) {
    tools.sednaInbox = createTool(Object.freeze({
      id: "sedna_inbox",
      description: describe("sedna_inbox"),
      inputSchema: z.object({ action: z.enum(["new"]), acknowledgement: statusLine }),
      execute: () => run("sedna_inbox", "new", async (access, person, entry) => {
        const key = `sedna:${entry.id}`;
        const { routine, positions } = routineFeed;
        const from = positions.has(key) ? positions.get(key) : routine.feeds?.[key] || null;
        const startedAt = routine.createdAt ? new Date(routine.createdAt).toISOString() : "";
        const read = await feedSince(access, person, from, { startedAt });
        positions.set(key, read.position);
        return {
          messages: read.messages,
          more: read.more,
          note: read.more
            ? `There's more new mail than one run reads (${FEED_MESSAGES} messages, ${read.pagesRead} pages of Sedna's feed): say so; the next run carries on from here.`
            : from ? "That's all the new mail since the last run." : "The routine starts watching now: this run reads only what came in since it was made."
        };
      })
    }));
  }
  return tools;
}
