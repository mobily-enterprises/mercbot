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
- `src/components/mercbot/appBadge.js`
- `src/components/mercbot/MercbotSettingsNotifications.vue`
- `src/components/mercbot/MercbotAccountMenu.vue`
- `src/components/mercbot/accountApi.js`
- `src/styles/mercbot.css`
- `help/install.md`

## Public contract

The web app manifest (`/manifest.webmanifest`) installs Mercbot as a standalone app with its icons, light and dark
theme colours, shortcuts (`/?go=new-chat`, `/?settings=recurring-tasks`, `/?settings=files`) and a share target
(`POST /share`, multipart: title, text, url, files). The service worker (`/sw.js`, scope `/`) answers a page that can't
load with `/offline.html`, never for `/api`, `/a`, `/p` or `/console`, keeps the built files under `/assets/` and
nothing else, and turns a share into `/?go=share&key=<key>`, where the shell asks **Send to a chat**.

`GET /api/w/:workspaceSlug/push` answers the signed-in person's own `{ enabled, publicKey, settings, devices }`:
`enabled` is false without `MERCBOT_PUSH_SECRET`; `settings` are `results`, `waiting`, `messages`, `showText`,
`quietFrom`, `quietTo` (HH:MM or null) and `timeZone`; each device is `{ id, label, endpoint, createdAt, lastSentAt }`.
`PUT …/push/settings` changes any of them (400 `account_push_setting`, `account_push_quiet_hours`,
`account_push_time_zone`); `POST …/push/devices` keeps the browser's subscription `{ endpoint, keys: { p256dh, auth },
label }` (409 `account_push_off` without the secret; 400 `account_push_endpoint` for anything but an https address,
`account_push_keys`); `DELETE …/push/devices/:deviceId` forgets one of the person's own (404
`account_push_device_missing` for anyone else's). Each answers the person's state as GET does.

A notification's payload is `{ title, body, url, tag, unread }`: the chat's or the author's name in it, the message's
words (or, with `showText` off, only its kind), the chat's address, `chat-<id>`, and the person's unread chats in that
home for the app's icon.

## Behavior

A message's append queues a notification (`push_queue`, one insert in the append's transaction, nothing read but the
chat's people) for each person it concerns (`pushRecipients`): everyone but its author and those who muted the chat in
a chat of one person or two people's direct chat (the chat's own update in the append says which, in the same
statement), else those a message mentions and the person a bot's work is for. Its kind is `waiting` when a bot's message
asks something of them, `results` for a bot's post in background work (a routine or a watch), else `messages`.

Every 5 seconds a web server's sweep claims up to 100 due rows (SKIP LOCKED, so once across servers) and, with them,
each person's other rows for that chat, due or not, deleting them all in one short transaction; each person and chat
becomes one notification about the newest message, as the most pressing kind. Those whose chat is now read (not
unread, or read past the message) or muted, or whose chat or message is gone, are dropped. The rest go as their
person's settings allow (the kind on, outside quiet hours) to every device of theirs: in production through web push
(TTL 6 hours, the tag as its topic), elsewhere logged. A 404 or 410 from the push service, or the fifth failure in a
row, forgets the device.

On the device the service worker shows it with the chat's tag (a newer one replaces it), sets the icon's count, and
opening it focuses a Mercbot window and goes to the chat, or opens one.

The icon's count is one a device: the person's chats with news in every home, a chat they muted left out
(`unreadChats`, one query however many homes), the notification's `unread`. With the app open, `appBadge.js` sets it to
the shown home's chats with news, as the page lists them, plus the other homes' (`GET
/api/w/:workspaceSlug/chats/unread-elsewhere`, always the signed-in person's), read when the page opens, when it's
shown again, and when the page's stream (every chat of the person's, `useChatEvents.js`) brings news of a chat it
doesn't list.

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
`tests/server/push.integration.js` (settings and devices kept to their person, production-only sending and forgetting
gone devices, the 15-second rule, folding, read and muted chats, settings, and fixed query counts at 5 and 41 people).
