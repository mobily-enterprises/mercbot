import { retryLostInsertRace } from "@jskit-ai/database-runtime/shared";
import { passedOn } from "@jskit-ai/resource-runtime/server";
import { GateError } from "./validate.js";

// Sending without a button press (D-137): an app's jobs and public forms may notify the home's members (a message from
// the home's main bot in each one's chat with it) and send email from one of the home's connected mailboxes, each only
// when the app's owners and admins switched it on (`apps.sending`), within a daily limit for the app (`daily`, 50 unless
// they choose 1 to 500) counted in the database, so every server counts the same (`app_send_counts`); a public form's
// emails reach one address at most VISITOR_DAILY times a day, so a visitor can't use it to mail someone over and over.
// Each send is in the app's activity. The bots make them (mercbot.app-connected: appMessages.js).
const SEND_DAILY = Object.freeze({ standard: 50, max: 500 });
const VISITOR_DAILY = 3;
const TO_MAX = 10;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;

/** A refusal of a send, in words for the app's people. */
const refused = (message, code) => new GateError(409, message, { code });

/** An app's sending settings, as stored or none: { notify, email, account, daily }. */
export const sendingOf = (app) => ({
  notify: Boolean(app?.sending?.notify),
  email: Boolean(app?.sending?.email),
  account: app?.sending?.account ?? null,
  daily: Number(app?.sending?.daily) || SEND_DAILY.standard
});

/**
 * @param {object} dependencies
 * @param {Record<string, import("@jskit-ai/resource-runtime/server/types").ResourceHandle>} dependencies.resources
 *   AppsFeature's handles: apps, appSendCounts and auditEvents
 * @param {() => import("./types.js").AppConnected} dependencies.connected read at call time: the bots' (mailboxes,
 *   members, managers, notifyMembers, sendEmail)
 */
export function createAppSending({ resources, connected }) {
  const { apps: appRows, appSendCounts, auditEvents } = resources;

  /**
   * Owners and admins switch an app's sending on or off and choose its mailbox and daily limit: `input` as the Logic tab
   * sends it; the mailbox must be one of the home's connected ones. Audited.
   */
  async function choose(actor, app, input, options) {
    const daily = Math.trunc(Number(input?.daily ?? SEND_DAILY.standard));
    if (!(daily >= 1 && daily <= SEND_DAILY.max)) {
      throw new GateError(400, `The daily limit is 1 to ${SEND_DAILY.max}.`, { code: "apps_sending_daily_invalid" });
    }
    const account = input?.account ? String(input.account) : null;
    if (account && !(await connected().mailboxes(options)).some((mailbox) => mailbox.id === account)) {
      throw new GateError(400, "That mailbox isn't one of the home's connected Gmail or Outlook accounts.", { code: "apps_sending_mailbox_unknown" });
    }
    if (input?.email && !account) throw new GateError(400, "Choose the mailbox the app's email goes from.", { code: "apps_sending_mailbox_missing" });
    const sending = { notify: Boolean(input?.notify), email: Boolean(input?.email), account, daily };
    await appRows.withTransaction(options, async (txOptions) => {
      await appRows.patch(app.id, { sending }, { ...txOptions, returning: "none" });
      await auditEvents.create({ actor, via: { kind: "app", appId: app.id }, action: "app", changes: { sending: { name: app.name, ...sending } } }, { ...txOptions, returning: "none" });
    });
    return sending;
  }

  /** Today's counts of an app's sends (UTC day): { notices, emails }. */
  async function today(app, options) {
    const rows = await appSendCounts.queryAll({ filters: { appId: app.id, day: dayNow() } }, passedOn(options));
    const counts = Object.fromEntries(rows.map((row) => [row.what, row.count]));
    return { notices: counts.notice ?? 0, emails: counts.email ?? 0 };
  }

  /** One more of `what` today for the app, `by` at a time, when it stays within `cap`; else false. Counted under its row's lock. */
  function counted(appId, what, cap, by, options) {
    return retryLostInsertRace(options, () => appSendCounts.withTransaction(passedOn(options), async (txOptions) => {
      const [row] = await appSendCounts.lockWhere({ appId, day: dayNow(), what }, txOptions);
      if ((row?.count ?? 0) + by > cap) return false;
      if (row) await appSendCounts.patch(row.id, { count: row.count + by }, { ...txOptions, returning: "none" });
      else await appSendCounts.create({ appId, day: dayNow(), what, count: by }, { ...txOptions, returning: "none" });
      return true;
    }));
  }

  const recorded = (ctx, app, sent) => auditEvents.create(
    { actor: ctx.actor, via: ctx.via || { kind: "app", appId: app.id }, action: "sent", changes: { sent: { app: app.name, ...sent } } },
    { ...passedOn(ctx.options), returning: "none" }
  );

  /**
   * A notice to members: `to` a member's id, a list of them (20 at most) or "owners" (the home's owners and admins);
   * `text` up to 1,000 characters, which they read as "From <app>: <text>". Refused unless the app may notify, past its
   * daily limit (each person reached counts one), or for someone who isn't in the home.
   */
  async function notify(ctx, app, { to, text } = {}) {
    const settings = sendingOf(app);
    if (!settings.notify) throw refused("This app may not notify members: an owner or admin switches it on in the app's Logic tab.", "apps_notify_off");
    const words = String(text ?? "").trim();
    if (!words || words.length > 1000) throw refused("A notice is 1 to 1,000 characters.", "apps_notify_invalid");
    const call = { context: ctx.options.context };
    const asked = to === "owners" ? await connected().managers(call) : [to].flat().map(String);
    const home = new Set((await connected().members(call)).map(String));
    const userIds = [...new Set(asked)];
    if (!userIds.length || userIds.length > 20 || userIds.some((id) => !home.has(id))) {
      throw refused("A notice goes to someone in the home (by id), up to 20 of them, or to \"owners\".", "apps_notify_invalid");
    }
    if (!(await counted(app.id, "notice", settings.daily, userIds.length, call))) {
      throw refused(`This app has sent its ${settings.daily} notices for today.`, "apps_send_limit");
    }
    await connected().notifyMembers(call, { userIds, text: `From ${app.name}: ${words}` });
    await recorded(ctx, app, { kind: "notice", to: userIds.length });
    return { notified: userIds.length };
  }

  /**
   * An email from the app's mailbox: `to` an address or a list (10 at most), `subject` up to 300 characters and `text`
   * up to 20,000. Refused unless the app may send email, past its daily limit (one a message), and for a public form
   * (`visitor`) past VISITOR_DAILY emails to one address a day.
   */
  async function email(ctx, app, { to, subject, text } = {}, { visitor = false } = {}) {
    const settings = sendingOf(app);
    if (!settings.email || !settings.account) {
      throw refused("This app may not send email: an owner or admin switches it on, with a mailbox, in the app's Logic tab.", "apps_email_off");
    }
    const addresses = [...new Set([to].flat().map((address) => String(address ?? "").trim().toLowerCase()))];
    if (!addresses.length || addresses.length > TO_MAX || addresses.some((address) => !EMAIL.test(address))) {
      throw refused(`An email goes to 1 to ${TO_MAX} valid addresses.`, "apps_email_invalid");
    }
    const title = String(subject ?? "").trim();
    const body = String(text ?? "");
    if (!title || title.length > 300 || !body.trim() || body.length > 20000) {
      throw refused("An email has a subject (up to 300 characters) and a text (up to 20,000).", "apps_email_invalid");
    }
    const call = { context: ctx.options.context };
    if (visitor) {
      for (const address of addresses) {
        if (!(await counted(app.id, `to:${address}`, VISITOR_DAILY, 1, call))) {
          throw refused(`This form has emailed ${address} ${VISITOR_DAILY} times today.`, "apps_send_limit");
        }
      }
    }
    if (!(await counted(app.id, "email", settings.daily, 1, call))) throw refused(`This app has sent its ${settings.daily} emails for today.`, "apps_send_limit");
    const sent = await connected().sendEmail(call, { account: settings.account, to: addresses, subject: title, text: body });
    await recorded(ctx, app, { kind: "email", to: addresses.length, subject: title.slice(0, 120), ...(sent?.simulated ? { logged: true } : {}) });
    return { sent: addresses.length, ...(sent?.simulated ? { logged: true } : {}) };
  }

  /**
   * A job's `notify.member(...)` or `notify.email(...)` (`name`: member or email): the app as it is now; a draft's
   * preview only says what it would send.
   */
  async function fromRun(ctx, appId, name, input) {
    const app = await appRows.get(String(appId), { fields: ["id", "name", "sending"] }, passedOn(ctx.options));
    if (ctx.practice) {
      ctx.practice.simulated.push({ sent: { kind: name === "email" ? "email" : "notice" }, script: ctx.via?.script });
      return { simulated: true };
    }
    return name === "email" ? email(ctx, app, input) : notify(ctx, app, input);
  }

  return Object.freeze({
    choose,
    today,
    notify,
    email,
    fromRun
  });
}

/** Today, as a send is counted: the UTC day. */
const dayNow = () => new Date().toISOString().slice(0, 10);
