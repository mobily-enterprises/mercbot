# Running your own copy of Mercbot

Mercbot runs on your own Linux computer (Ubuntu 24.04 or Debian 12 on x86_64), for you alone. This page is for you, as the person who installs and looks after your copy. It describes what your copy is made of, how it opens, the `mercbot` command that looks after it, the settings it needs (names and purposes only, never real values), how to connect your Google, Microsoft and GitHub accounts, where files are kept, and backups and upgrades. It ends with a checklist.

## What your copy is

- **Just for you.** It has no sign-in, accounts, members or invitations. It makes one person, you, the first time it starts. You can still have several homes, each with its own chats and bots. Chats are still Public or Private, as in any home: with only you in it, both are yours alone, and the difference is in what the bots may use and save across chats (see [Rooms, people and bots](/help/chats)).
- **Opened with its key.** `mercbot open` opens it in your browser. The key is in `mercbot.key` in its data folder, readable only by you. Anything that doesn't carry it, including other people's accounts on the same computer and other websites, gets a page saying to open Mercbot with `mercbot open`. `mercbot new-key` makes a new key and signs every browser out.
- **Reached only from this computer,** at `localhost`, `127.0.0.1` or `[::1]`. It won't start with any other `HOST`, so shared pages are yours alone.
- **Run by you.** You may choose a folder on this computer for a home's website (see **Website** in [Settings and notifications](/help/settings)).

## What it's made of

| Part | What it is |
|---|---|
| The application | A standard Node application (Node 26), run as your own service, `mercbot.service` |
| PostgreSQL | One database holds everything: your homes, bots, chats, routines, approvals, the vault and Apps data |
| Bots' computers | A bot has its own computer in each chat it's in. Each awake one is a small desktop on your computer: a virtual display (Xvfb), a window manager (openbox), Chrome and a screen-sharing server (x11vnc), all bound to the computer itself |
| Bots' files | A folder in your copy's data folder, or an S3 bucket if you set one up. It also holds bots' saved browsers and screenshots |
| Tools | The office apps bots use to make documents, spreadsheets, slides and PDFs, rclone for a home's own storage, and a sandbox, installed by Mercbot's own script without root |

### What your computer needs

- Ubuntu 24.04 or Debian 12 on x86_64, and Node 26.
- For bots' computers: Xvfb, openbox, x11vnc and `tar` with zstd. Two small programs draw the desktop's bars and wallpaper; Mercbot's install script unpacks them when the system lacks them.
- A working sandbox. The office apps and the bots' browser only ever run sandboxed, which needs user namespaces. Ubuntu lets only programs it trusts make them, so the installer's one root step puts root's own copies of the two programs Mercbot needs in `/usr/local/lib/mercbot`, allowed just those. Mercbot never switches the restriction off for the whole computer. Without a working sandbox, the apps are unavailable and bots' computers don't start.

Before starting, Mercbot checks the computer and says which command fixes anything missing, such as `sudo apt-get install xvfb x11vnc openbox`.

As a rough guide, an awake bot computer used 310 to 460 MB of memory in Mercbot's own measurements, and each office app about 180 MB. Your copy keeps up to three computers awake at once unless you change it; idle ones go to sleep after five minutes.

## The `mercbot` command

Everything your copy keeps is in `~/.local/share/mercbot`: its releases, its data folder (with the key), its settings in `mercbot.env` (readable only by you) and its backups.

| Command | What it does |
|---|---|
| `mercbot start` | Starts Mercbot, and keeps it starting with the computer |
| `mercbot stop` | Stops Mercbot until `mercbot start` |
| `mercbot status` | Says whether it's running, and where |
| `mercbot open` | Opens it in your browser |
| `mercbot new-key` | Makes a new key and signs every browser out |
| `mercbot backup` | Saves the database, the data folder and the settings in one file. It holds the vault key: keep it where only you can read it |
| `mercbot restore FILE` | Brings a backup back. What was there before is kept beside it |
| `mercbot upgrade FILE` | Installs a newer release beside the one running, with a backup first. The release before is kept, and restoring that backup goes back to it |

The installer, which sets all this up in one go, is coming.

When Mercbot stops, requests in progress finish, routine runs and background work get up to 20 seconds, and every bot computer is saved. It stops after at most 25 seconds. Pages retry sends and replies that were cut off for about 15 seconds without doubling them, then catch up.

## Settings

Settings are in `mercbot.env`. Keep their values private.

| Group | Settings | Purpose |
|---|---|---|
| Where it answers | `HOST`, `PORT`, `APP_PUBLIC_URL` | `HOST` is `127.0.0.1` or `::1`, and `APP_PUBLIC_URL` your copy's own address on this computer, such as `http://localhost:3001`. Connected accounts build their links from it |
| Database | `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` | The PostgreSQL connection |
| Sessions | `AUTH_LOCAL_SESSION_SECRET` | Secures your browser's session |
| AI | `AI_PREMIUM_PROVIDER=together` and `AI_PREMIUM_API_KEY`, `AI_ECONOMY_PROVIDER=deepinfra` and `AI_ECONOMY_API_KEY`, `AI_IMAGES_PROVIDER=gemini` and `AI_IMAGES_API_KEY` | Mercbot's three kinds of AI, each with its provider and key: the premium AI (Together AI) for chats and the bots' browser steps, the slower, cheaper AI (DeepInfra) for the Builder and background work such as routines, watches, long jobs and summaries, and images (Google Gemini) for pictures and for reading contact details from photos in the vault. Without the premium or the slower, cheaper AI, your bots don't work: each says your copy's AI isn't set up and which settings to add. Without images, bots say pictures aren't set up on your copy, and the vault's photo buttons say reading photos isn't. Keys stay in Mercbot and never enter a bot's computer |
| Vault key | `MERCBOT_VAULT_KEY` | 32 random bytes. Seals vault secrets, connected-account tokens and bots' saved browsers |
| Hosting | `HOSTING_SCRIPT=scripts/hosting/local.sh` | The checks for your own computer, and where the root step's programs are (`MERCBOT_TRUSTED_DIR`, `/usr/local/lib/mercbot` by default) |
| Bots' files | `MERCBOT_FILES_S3_BUCKET`, `MERCBOT_FILES_S3_REGION`, `MERCBOT_FILES_S3_ACCESS_KEY_ID`, `MERCBOT_FILES_S3_SECRET_ACCESS_KEY`, `MERCBOT_FILES_PASSPHRASE`, and `MERCBOT_FILES_S3_ENDPOINT` for a store other than AWS | Optional: an S3 bucket (AWS's, or any store speaking the S3 API) to keep your bots' files in instead of the data folder, and the passphrase that seals every file before it leaves your computer. Keep the passphrase safe: the files can't be read without it |
| Where it runs | `APP_ENV`, `NODE_ENV` | Both `production` when your copy is for real use. `APP_ENV` set to `development` (or `staging`, which also needs `NODE_ENV=production`) makes a test copy that only logs what it would send. Mercbot doesn't start without `APP_ENV`, or while the old `SIDE_EFFECTS` setting is still there |
| Connected accounts | `GOOGLE_CLIENT_ID` / `_SECRET`, `MICROSOFT_CLIENT_ID` / `_SECRET`, `GITHUB_CLIENT_ID` / `_SECRET` | Your own registered apps with each provider, if you have them |
| GitHub for bots' commands | `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY` | Optional: your own GitHub App, so bots' commands can push to the repositories you allow. `GITHUB_CLIENT_ID` / `_SECRET` are then the App's. See [below](#with-your-own-registered-apps) |
| Hub | `MERCBOT_HUB_URL` | Another Mercbot this copy may link to, to connect accounts through its apps. No default |

An optional setting, `MERCBOT_MAX_COMPUTERS`, sets how many bots' computers are awake at once.

### Two settings you mustn't lose

- **The vault key.** Anything sealed with it (vault items, connected-account tokens, saved browsers, a home's own storage password, where a home publishes its pages and that website's keys) can't be recovered with a different key. Without any vault key, logins and cards can't be saved and bots' browsers aren't kept when their computer sleeps. `mercbot backup` keeps it with the rest.
- **The files passphrase,** if you keep files in an S3 bucket. Every file is sealed with a key it opens, kept in the bucket; without the passphrase the files can't be read.

Mercbot starts without any of these keys: each one you leave out turns its feature off, the feature says so where it's used, and Mercbot's log names each missing key when it starts. Without `MERCBOT_FILES_PASSPHRASE` or any of the bucket's settings, files stay in the data folder.

Unless `APP_ENV` is `production`, your copy is a test copy: what bots would send or show to others from connected accounts (emails, calendar invitations and answers, Drive sharing and comments, on GitHub comments, reviews, new and changed issues and pull requests, merges, releases, discussion changes and reruns of automation runs, and the actions of Calendly, Notion and Todoist that tell other people, such as cancelling a meeting or adding a comment) and scripts' web calls other than reads are written to the log instead, and every page shows a small tab at the top naming where it runs, such as "Development" or "Staging". Everything else works as usual.

## Connected accounts: your own apps or a hub

You connect Google, Microsoft and GitHub accounts by signing in on the provider's own page. Your copy can do that in one of two ways.

Calendly, Notion and Todoist need neither: your copy registers itself with each of them the first time you connect it, and you sign in there directly. Calendly only accepts a copy whose address starts with `https://`; on your copy's `http://` address, connecting it says Calendly didn't let Mercbot register, with Calendly's reason.

### With your own registered apps

Register an app with each provider, set its client ID and secret, and register `<APP_PUBLIC_URL>/api/connections/callback` as its return address. Each app's permissions are listed in its folder under `plugins/`, so you know what to ask the provider for. Some, such as Gmail and full Google Drive access, are restricted by Google and need its review before the app can leave testing.

For GitHub, register a **GitHub App** (GitHub's **Settings** → **Developer settings** → **GitHub Apps**) if you want bots' commands to push to your repositories:

1. Its callback is `<APP_PUBLIC_URL>/api/connections/callback`, with **Expire user authorization tokens** on and **Request user authorization (OAuth) during installation** off. Its **Setup URL** is `<APP_PUBLIC_URL>/api/connections/github/installed`, with **Redirect on update** on. Turn its webhook off.
2. Give it these repository permissions: Contents, Pull requests and Issues **Read and write**; Actions, Checks, Commit statuses and Metadata **Read-only**. Don't give it Workflows, or any organisation or account permissions.
3. Generate a client secret and a private key on its page. Set `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` to its client ID and that secret, `GITHUB_APP_ID` to its App ID, `GITHUB_APP_SLUG` to its name in its `github.com/apps/…` address, and `GITHUB_APP_PRIVATE_KEY` to the key file's contents. On a `localhost` address, the same names with `GITHUB_TEST_` in place of `GITHUB_` (`GITHUB_TEST_APP_ID`, `GITHUB_TEST_CLIENT_ID` and so on) are used instead when they're set.

The private key never leaves your copy: each command that works on a repository gets a key of the App's for that one repository, which lasts at most an hour and is withdrawn when the command ends. A copy linked to a hub can't push from bots' commands, since the hub's App key stays on the hub.

### Linked to a Mercbot hub

If you don't want to register apps, link your copy to an account on another Mercbot that connects accounts for it (the hub named in `MERCBOT_HUB_URL`):

1. In your copy, open **Settings** and choose **Mercbot account**.
2. Give the copy a name (for example, "My Mercbot") and press **Link**.
3. A tab opens on the hub. Sign in there, check that it shows the same code, and approve.
4. Your copy now shows "Linked to *hub* as *name*". Connecting Google, Microsoft or GitHub goes through your account there.

When you connect an account, the sign-in tab opens on the hub first: sign in there with the account your copy is linked to, if that browser isn't signed in already, and it goes on to the provider's page. This ties the sign-in to your browser, so a sign-in link that reaches anyone else connects nothing. Signed in to the hub with another account, the tab says the sign-in is for another Mercbot account: sign in with the linked one and start again from your copy.

Providers send you back to the hub, which keeps the long-lived permission. Your copy gets short-lived keys every hour and talks to the provider directly, so your mail, calendars and files don't go through the hub. **Unlink** stops it at any time. A hub can also list the copies linked to your account there, each with its own **Unlink**.

Without either, bots can still use the providers' websites in their browser.

Your copy is reached only on this computer, so it can't receive the provider's return visit itself. Connect apps then shows a box where you paste the address the sign-in tab ended on.

## Where files are kept

- **In the data folder:** without `MERCBOT_FILES_DIR`, bots' files stay in a folder in your copy's data folder.
- **In an S3 bucket:** with the bucket's settings and the files passphrase, files are kept in an S3 bucket (AWS's, or any store speaking the S3 API, at `MERCBOT_FILES_S3_ENDPOINT`), each sealed on your computer before it's sent, so the bucket's owner can't read them. Mercbot keeps a copy of the files it uses in its data folder and sends what changes to the bucket within seconds, and before it stops. While the bucket can't be reached or the passphrase doesn't open it, Mercbot says files are unavailable rather than writing them elsewhere.
- **A home's own storage:** you can choose to keep a home's files in your own WebDAV storage, such as Nextcloud, or in a Google Drive account connected in Connect apps (which needs Google sign-in set up, or a linked hub). That storage needs the vault key; Mercbot reaches it through rclone, with no mount, and keeps a copy of what it uses. Google Drive asks Mercbot for each key, on Mercbot's own port, so the account's permission never leaves the app.

While a bot's computer is awake, its browser profile lives in the data folder. When it sleeps or Mercbot stops, the profile is saved, sealed, with the bots' files; its cookies are also saved every 30 seconds while awake, so it wakes again with its sign-ins intact.

Profile pictures are kept with the bots' files.

**Settings**, **About** shows the version and build date, and **Spending** shows what each home's bots cost at the AI providers. Check what's left with your model providers on their own websites.

## Checklist

1. Your computer runs Ubuntu 24.04 or Debian 12 on x86_64, with Node 26, Xvfb, openbox, x11vnc and `tar` with zstd, and the sandbox works (on Ubuntu, after the installer's root step).
2. PostgreSQL is reachable, with a user that can run migrations.
3. `HOST` is `127.0.0.1` or `::1`, and `APP_PUBLIC_URL` is your copy's address on this computer. Without it, links point at `http://localhost`.
4. A strong session secret and the vault key are set, and `mercbot backup` files are kept where only you can read them.
5. The premium and the slower, cheaper AI have their providers and keys, so your bots work.
6. `APP_ENV` and `NODE_ENV` are both `production` once your copy is for real use.
7. Connected accounts work through your own registered apps or a linked hub.
8. `mercbot status` says Mercbot is running, and `mercbot open` opens it.

## Questions

### Can other people use my copy?

No. It has one person, you, and answers only on this computer. Anything else gets a page saying to open Mercbot with `mercbot open`, which only works with your key.

### Do I need my own AI keys?

Yes. Your copy runs on the provider keys you set. **Spending** shows what each bot's work cost at those providers; what your accounts there have left is on the providers' own websites.

### Does linking to a hub send my mail through it?

No. The hub only keeps the permission and hands your copy short-lived keys. Your copy talks to Google, Microsoft and GitHub directly.

### What if my computer restarts?

`mercbot start` keeps Mercbot starting with the computer. Bots' browsers are saved every 30 seconds while awake, so they come back with their sign-ins.

## Related pages

- [Security overview](/help/security)
- [Security questions and answers](/help/security-questions)
- [Homes: Mercbot for families and businesses](/help/homes)
- [The bots' computer and connected apps](/help/computer-and-apps)
- [Files, documents and pictures](/help/files)
- [Settings and notifications](/help/settings)
