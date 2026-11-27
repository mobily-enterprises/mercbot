import assert from "node:assert/strict";
import test from "node:test";
import { appsHome, appsParts } from "../support/appsHome.mjs";
import { cleanupStack } from "../support/cleanupStack.mjs";
import { queriesDuring } from "../support/queryCount.mjs";
import { createRuntime } from "../../packages/apps/src/server/runtime.js";
import { createScripts } from "../../packages/apps/src/server/scripts.js";
import { compile } from "../../packages/apps/src/server/visitorAccess.js";

// Sending without a button press (D-137), on the test database: nothing goes until an owner or admin switches it on for
// the app (a mailbox for email), each kind within the app's daily limit, counted in the database; a job sends with
// notify.member and notify.email; a public form's onSubmit emails the visitor and tells the owners, at most 3 emails a
// day to one address, its record kept whatever happens; each send is in the activity. The bots' part is a stand-in.
assert.ok(process.env.TEST_DB_NAME?.trim(), "TEST_DB_NAME must identify a disposable test database.");
assert.equal(process.env.DB_NAME, process.env.TEST_DB_NAME, "DB_NAME must match the dedicated TEST_DB_NAME.");

test("an app sends only what its owners switched on, within its limits, from jobs and public forms", async (context) => {
  const cleanup = cleanupStack(context);
  const home = await appsHome(cleanup, { slug: "apps-sending" });
  const { knex, options } = home;
  const owner = { type: "person", id: String(home.userId), name: "Pat" };
  const ctx = home.ctx(owner);
  const sent = { notices: [], emails: [] };
  const bots = {
    mailboxes: async () => [{ id: "9", app: "gmail", address: "office@acme.example" }],
    members: async () => [String(home.userId), "8"],
    managers: async () => [String(home.userId)],
    notifyMembers: async (_call, notice) => sent.notices.push(notice),
    sendEmail: async (_call, mail) => {
      sent.emails.push(mail);
      return { simulated: true };
    }
  };
  let scripts = null;
  const { resources, repository, registry, gate, apps, practices, systemContext, roleOf } = appsParts(home, {
    trustMs: Infinity,
    beforeSave: (...args) => scripts.beforeSave(...args)
  });
  scripts = createScripts({ roleOf, resources, repository, systemContext, registry, gate, apps, env: process.env, homeBots: async () => [], connected: () => bots });
  cleanup.after(() => scripts.close());
  const runtime = createRuntime({ apps, gate, scripts, practices });
  const { sending } = scripts;
  await registry.createTable(owner, { key: "signups", fields: [{ key: "name", type: "text" }, { key: "email", type: "email" }] }, options);
  await apps.createApp(owner, { name: "Events" }, options);
  const app = () => apps.find("events", options);
  const code = async (work) => (await work.catch((error) => error)).code;

  // ---- Nothing until an owner or admin switches it on ----
  const mail = { to: "sam@example.com", subject: "Reminder", text: "Tomorrow at 9." };
  assert.equal(await code(sending.email(ctx, await app(), mail)), "apps_email_off");
  assert.equal(await code(sending.notify(ctx, await app(), { to: "owners", text: "Hi" })), "apps_notify_off");
  assert.equal(await code(sending.choose(owner, await app(), { email: true }, options)), "apps_sending_mailbox_missing");
  assert.equal(await code(sending.choose(owner, await app(), { email: true, account: "77" }, options)), "apps_sending_mailbox_unknown");
  assert.equal(await code(sending.choose(owner, await app(), { notify: true, daily: 501 }, options)), "apps_sending_daily_invalid");
  await sending.choose(owner, await app(), { notify: true, email: true, account: "9", daily: 3 }, options);

  // ---- Within the daily limit, counted in the database; members only; a send costs the same after a year of sends ----
  assert.deepEqual(await sending.email(ctx, await app(), mail), { sent: 1, logged: true });
  const later = (to) => queriesDuring(knex, async () => sending.email(ctx, await app(), { ...mail, to }));
  const second = await later(["a@example.com", "B@Example.com"]);
  const events = await app();
  const days = Array.from({ length: 365 }, (_, index) => new Date(Date.now() - (index + 1) * 86_400_000).toISOString().slice(0, 10));
  await knex("app_send_counts").insert(days.flatMap((day) => ["email", "notice", "to:sam@example.com"].map((what) => ({ workspace_id: home.workspaceId, app_id: events.id, day, what, count: 9 }))));
  assert.equal(await later("c@example.com"), second, "a send reads the same with 1,095 earlier counts");
  assert.equal(await code(sending.email(ctx, await app(), mail)), "apps_send_limit", "the fourth of a limit of 3");
  assert.deepEqual(sent.emails.map((each) => [each.account, each.to]), [["9", ["sam@example.com"]], ["9", ["a@example.com", "b@example.com"]], ["9", ["c@example.com"]]]);
  assert.equal(await code(sending.notify(ctx, await app(), { to: "99", text: "Hi" })), "apps_notify_invalid", "not in the home");
  await sending.notify(ctx, await app(), { to: "owners", text: "New booking" });
  assert.deepEqual(sent.notices.at(-1), { userIds: [String(home.userId)], text: "From Events: New booking" });
  assert.deepEqual(await sending.today(await app(), options), { notices: 1, emails: 3 });

  // ---- A job sends with notify.member and notify.email ----
  await sending.choose(owner, await app(), { notify: true, email: false, daily: 50 }, options);
  const job = `async function main() {
    await notify.member({ to: "owners", text: "Daily summary ready" });
    await notify.email({ to: "sam@example.com", subject: "Summary", text: "x" });
    return {};
  }`;
  assert.deepEqual((await scripts.save(owner, "events", {
    key: "daily_summary", kind: "job", summary: "Sends the summary", settings: { every: "day", at: "07:00" }, code: job,
    tests: [{ name: "sends", input: {}, notify: { member: { notified: 1 }, email: { sent: 1 } }, expect: {} }]
  }, options)).errors, []);
  await apps.publish(owner, "events", {}, options);
  await knex("app_scripts").where({ key: "daily_summary", draft: false }).update({ next_run_at: new Date(Date.now() - 1000) });
  await scripts.runDue({ matchChanges: async () => [] });
  assert.equal(sent.notices.at(-1).text, "From Events: Daily summary ready", "the job's notice went");
  const [run] = await knex("app_script_runs").join("app_scripts", "app_scripts.id", "app_script_runs.script_id").where({ "app_scripts.key": "daily_summary" }).select("app_script_runs.error");
  assert.match(run.error, /may not send email/u, "its email was refused: email is off");

  // ---- A public form's onSubmit: the visitor's email at most 3 a day; the owners told; the record kept ----
  await sending.choose(owner, await app(), { notify: true, email: true, account: "9", daily: 50 }, options);
  const definition = {
    home: "signup",
    screens: {
      signup: {
        public: true,
        content: [{
          type: "form",
          table: "signups",
          fields: ["name", "email"],
          buttons: [{ type: "button", label: "Sign up", do: [{ create: { table: "signups", values: "=form.values" } }] }],
          onSubmit: [
            { email: { to: "=record.email", subject: "You're in", text: '="See you there, " + record.name' } },
            { notify: { to: "owners", text: '="New sign-up: " + record.name' } }
          ]
        }]
      }
    },
    public: { home: "signup", tables: { signups: { can: ["create"], write: ["name", "email"] } } }
  };
  assert.deepEqual((await apps.saveDraft(owner, "events", definition, "", options)).errors, []);
  await apps.publish(owner, "events", {}, options);
  const visitor = { signedIn: false, email: "" };
  const visitorCtx = { options: home.job, actor: { type: "visitor", id: null, name: "Events (public form)" }, visitor, access: compile(definition, await registry.loadTables(options), visitor) };
  const appId = (await app()).id;
  const press = (name) => runtime.action(visitorCtx, { slug: appId, screen: "signup", path: "content/0/buttons/0/do", values: { name, email: "Ana@Example.com" } });
  const before = sent.emails.length;
  for (const name of ["Ana", "Ana 2", "Ana 3", "Ana 4"]) await press(name);
  assert.deepEqual(sent.emails.slice(before).map((each) => [each.to, each.subject, each.text]), [
    [["ana@example.com"], "You're in", "See you there, Ana"],
    [["ana@example.com"], "You're in", "See you there, Ana 2"],
    [["ana@example.com"], "You're in", "See you there, Ana 3"]
  ], "one address at most 3 times a day");
  assert.equal(sent.notices.at(-1).text, "From Events: New sign-up: Ana 4", "the owners are told each time");
  assert.equal((await gate.read(ctx, "signups", { page: { size: 10 } })).records.length, 4, "every sign-up is kept");
  const activity = await knex("audit_events").where({ action: "sent" }).whereRaw("changes->'sent'->>'app' = ?", ["Events"]).count({ n: "*" });
  assert.ok(Number(activity[0].n) >= 9, "each send is in the activity");
});
