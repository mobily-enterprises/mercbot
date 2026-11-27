# Sending without a button press

Lets an app's jobs and public forms notify the home's members in Mercbot and send email from a mailbox the owners
chose (D-137), each only when an owner or admin switched it on for the app, within daily limits counted in the
database.

## Sources

- Main: `packages/apps/src/server/appSending.js`
- `packages/apps/src/server/submitSends.js`
- `packages/apps/src/shared/onSubmit.js`
- `src/components/apps/AppLogic.vue`
- `migrations/20261205140000_app_sending.cjs`

## Public contract

- Settings per app, `apps.sending` { notify, email, account, daily }: owners and admins choose them
  (`PUT …/apps/:slug/sending`, 403 for others; `GET` gives the settings, today's counts and, to them, the home's
  mailboxes); the mailbox must be one of the home's connected Gmail or Outlook accounts; the daily limit is 1 to 500
  (50). Refusals `apps_sending_daily_invalid`, `apps_sending_mailbox_unknown`, `apps_sending_mailbox_missing`. Audited.
- `notify` (to "owners", the home's owners and admins, or members by id, up to 20; 1 to 1,000 characters, read as
  "From <app>: …") and `email` (1 to 10 addresses, a subject up to 300 characters and a text up to 20,000) refuse
  when off (`apps_notify_off`, `apps_email_off`), for someone outside the home (`apps_notify_invalid`) and past the
  daily limit (`apps_send_limit`): `app_send_counts` (app, UTC day, what, count) counted under the row's lock, each
  person a notice reaches one, each email one, and for a public form at most 3 emails a day to one address. Each send
  is an activity row (action `sent`; a logged one says so).
- Jobs call `notify.member` and `notify.email` (`fromRun`, the app as it is now); a draft's preview only says what it
  would send.
- A create form's `onSubmit` (up to 3 `email`/`notify` sends, checked by `shared/onSubmit.js`, formulas seeing the
  added record as `record`, stored by ids) runs after its button's steps succeed, never in a preview
  (`submitSends.js`); on a public screen its formulas read only what visitors may read besides that record. The record
  stays whatever a send does: a refusal is said to a member and logged for a visitor.
- The bots make the sends (`mercbot.app-connected`, `genesis/program/bots/app-connected.md`): a notice is the home's
  main bot's message in each person's own chat with it; an email goes through Gmail's or Outlook's send, logged
  instead outside production (D-69).

## Proved by

- `tests/server/appsSending.integration.js`
- `tests/server/appsSending.test.js`
