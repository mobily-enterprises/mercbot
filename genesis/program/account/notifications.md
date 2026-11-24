# Mercbot as an installed app, and its notifications

Mercbot installs from its own address on phones, tablets and computers, works offline enough to say so, takes what
other apps share into it, and sends people notifications on their devices when a bot has news (D-133).

## Sources

- Main: `packages/account/src/server/push.js`
- `packages/account/src/server/registerRoutes.js`
- `packages/account/src/server/tableResources.js`
- `packages/account/src/server/keys.js`
- `packages/bots/src/server/records/pushQueueRepository.js`
- `packages/bots/src/server/records/messageRepository.js`
- `packages/bots/src/server/pushSweep.js`
- `packages/bots/src/server/botLoops.js`
- `migrations/20261129120000_push_notifications.cjs`
- `src/public/manifest.webmanifest`
- `src/public/sw.js`
- `src/public/offline.html`
- `src/public/offline.js`
- `src/public/app-icons`
- `index.html`
- `src/main.js`
- `src/components/mercbot/appInstall.js`
- `src/components/mercbot/MercbotAppDevice.vue`
- `src/components/mercbot/MercbotSettingsNotifications.vue`
- `src/components/mercbot/MercbotAccountMenu.vue`
- `src/components/mercbot/accountApi.js`
- `src/styles/mercbot.css`
- `help/install.md`

## Public contract

The web app manifest (`/manifest.webmanifest`) installs Mercbot as a standalone app with its icons, light and dark
theme colours, shortcuts (`/?go=new-chat`, `/?settings=recurring-tasks`, `/?settings=files`) and a share target
(`POST /share`, multipart: title, text, url, files). The service worker (`/sw.js`, scope `/`) answers a page that can't
load with `/offline.html`, never for `/api`, `/a`, `/p` or `/console`, and the offline page's script and icon from
its own copy when the network can't give them; it keeps the built files under `/assets/` and nothing else, and turns a share into `/?go=share&key=<key>`, where the shell asks **Send to a chat**.

`GET /api/w/:workspaceSlug/push` answers the signed-in person's own `{ enabled, publicKey, settings, devices }`:
`enabled` is false without `MERCBOT_PUSH_SECRET`; `settings` are `results`, `waiting`, `messages`, `showText`,
`quietFrom`, `quietTo` (HH:MM or null) and `timeZone`; each device is `{ id, label, endpoint, createdAt, lastSentAt }`.
`PUT …/push/settings` changes any of them (400 `account_push_setting`, `account_push_quiet_hours`,
`account_push_time_zone`); `POST …/push/devices` keeps the browser's subscription `{ endpoint, keys: { p256dh, auth },
label }` (409 `account_push_off` without the secret; 400 `account_push_endpoint` for anything but a known push
service's https address on its default port with no credentials, since the server POSTs there when it sends: Chrome's
and Edge's FCM, Firefox's, Safari's and Windows' WNS; 400 `account_push_keys`; 409 `account_push_device_taken` for a
device another person allowed, unless it comes with that device's own keys, the same browser signed in as someone else
now). The label is kept as one line. `DELETE …/push/devices/:deviceId` forgets one of the person's own (404
`account_push_device_missing` for anyone else's). A body that isn't an object is refused (400). Each answers the
person's state as GET does; signed out, each is 401, and outside the home 404. `POST /api/push/devices/forget`
`{ endpoint }`, from any page and in no home, forgets the signed-in person's own device at that push address, as a
browser signing out asks, and answers `{ forgotten }` (false for an address not theirs; 400 `account_push_endpoint` for
one that isn't a string of at most 2,000 characters): one locked delete by the unique address, however many devices.

A notification's payload is `{ title, body, url, tag, unread }`: the chat's or the author's name in it, the message's
words (or, with `showText` off, only its kind), the chat's address, `chat-<id>`, and the person's unread chats in that
home for the app's icon.

## Behavior

A message's append queues a notification (`push_queue`, one insert in the append's transaction, nothing read but the
chat's people) for each person it concerns (`pushRecipients`): everyone but its author and those who muted the chat in
a chat of one person or two people's direct chat (the chat's own update in the append says which, in the same
statement), else those a message mentions and the person a bot's work is for. Its kind is `waiting` when a bot's message
asks something of them, `results` for a bot's post in background work (a routine or a watch), else `messages`.

Every 5 seconds a web server's sweep claims due rows 100 at a time, batch after batch until one comes back short (at most 20 batches a sweep, the rest 5 seconds later), each batch up to 100 due rows (SKIP LOCKED, so once across servers), each with its
home, and, with them, those people's own other rows for those chats (exact person and chat pairs, never another
person's or chat's, up to 1,000; any past that wait for the next sweep), due or not, deleting them all in one short
transaction; each person and chat becomes one notification about the newest message, as the most pressing kind. Those
whose chat is now read (not unread, or read past the message) or muted, or whose chat or message is gone, are
dropped: the sweep reads only those people's own places in those chats. The rest go as their person's settings allow
(the kind on, outside quiet hours), named after the chat, the bot of a person's own chat with it, or the other person
of two people's direct chat, and linking to the chat in its home (the batch's homes read at once), to every device of
theirs: in production through web push (TTL 6 hours, the tag as its topic), ten devices' push services at a time,
elsewhere logged. A 404 or 410 from the push service, or the fifth failure in a row, forgets the device; what each
device answered is written for the whole batch in a few statements.

On the device the service worker shows it with the chat's tag (a newer one replaces it), sets the icon's count, and
opening it focuses a Mercbot window and goes to the chat, or opens one; an address on another site, or another scheme,
opens Mercbot's start instead. A device kept with an address outside the push services is never called and is
forgotten at the next send. A copy built on Mercbot that signs people out has the browser forget its subscription
first (`useAppInstall().stopNotifications()`).

The browser asks permission only when the person turns notifications on in Settings → General → Notifications, or
accepts the offer made once (remembered on the device) when they see their first routine set up in the open chat.

## Data

`push_devices` (a person's devices, the endpoint unique, at most 20 kept), `push_settings` (one row per person who
changed theirs; checks on the times' format), both the account's, with cascades from `users`; `push_queue`
(`(workspace_id, id)` key, indexed by `send_after` for the sweep and by person and chat for folding), the bots', with
cascades from homes, people and chats. Queueing is one statement whatever the number of people; the sweep's reads are a
fixed number per batch.

## Verification

`tests/server/pushRules.test.js` (keys, quiet hours, who hears of what, a notification's words) and
`tests/server/pushRoutes.integration.js` (the routes' refusals: signed out, outside the home, another person's device,
a forged request, a malformed body, an address inside the network), `tests/server/push.integration.js` (settings and devices kept to their person, production-only sending and forgetting
gone devices, the 15-second rule, folding past 1,000 other waiting notifications, read and muted chats, settings,
direct chats named after the other person, homes read once, 250 due in one sweep, the icon's count per home, each table's constraints, and fixed query counts at 5 and 41 people and at 3 and 30
devices), and `tests/server/serviceWorker.test.js` (the worker itself).
