# Start Mercbot

Mercbot is a Node application on PostgreSQL whose bots each have a small desktop computer and a
Linux command line, both in gVisor sandboxes. This guide covers starting it in a Vibe64 session's
Preview, what it needs first, opening it, publishing, and what to do when a start stops.

## What runs

- **Workspace setup** runs `npm ci`, then `npm run db:prepare`, which migrates the session's
  development database. Vibe64 supplies the database's `DB_*` settings.
- **Preview** runs the default output, **Run app** (`npm run develop`, preferred port 3001): Mercbot's API and
  its pages, inside Mercbot's own user and mount namespace (`scripts/namespace.sh`). It's ready when
  `GET /api/health` answers 200.
- **Test Preview** runs `test-app` on the test database with fixtures made for it. It clears every
  key, mail and sign-in setting, and every kind of AI is Mercbot's stand-in model, so no real key,
  AI provider, mail or sign-in provider is used.

## Before the first start

1. **AI keys (a human step).** Mercbot doesn't start without its premium and its slower, cheaper AI
   (D-72). The person adds `AI_PREMIUM_PROVIDER=together` with `AI_PREMIUM_API_KEY` (a Together AI
   key) and `AI_ECONOMY_PROVIDER=deepinfra` with `AI_ECONOMY_API_KEY` (a DeepInfra key) in the
   project's **Env** view under **Development**, the keys marked **Secret**. Never ask for or paste
   key values in the chat.
2. **Bots' tools.** Bots' computers, their command line, and the office apps behind their documents
   need `npm run tools:install`: gVisor, the toolbox (Ubuntu with Chrome and the command-line tools),
   the office apps, JuiceFS, rclone and Piper, all pinned, into `.tools/`. The first install takes
   15 to 25 minutes; later ones reinstall only a tool whose version changed. Without them bots still
   chat, but have no computer, command line or office apps.
3. **Optional settings** in Env: `AI_IMAGES_PROVIDER=gemini` with `AI_IMAGES_API_KEY` (pictures;
   without them bots say pictures aren't set up), and the Google, Microsoft and GitHub app keys
   (Connect apps) or `MERCBOT_HUB_URL`. docs/deployment.md lists every setting.

## Opening Mercbot

Mercbot is a person's own copy with one person, `you@mercbot.localhost`, and no sign-in: it opens with its
secret key (D-81), which its first start makes in the data folder (`.data/mercbot.key`). The Preview identity menu
opens it the same way. The project saves one identity in `.vibe64/preview-identities.json`, **you**: choosing it
opens `/open` with the copy's key (the Test Preview's from `.data-test`) and gives the Preview the key's cookie. Any
other address is refused ("This copy of Mercbot has one person, you@mercbot.localhost."), and signing out in the
menu drops the key's cookie. On a person's own computer, `mercbot open` does the same.

Every copy that isn't switched to Live is a test copy, the Preview included: it only logs what bots
would send from connected accounts and what Apps scripts would send to outside web services. A
built copy, such as the Test Preview or a published
one, also shows a small "Test copy" tab at the top; the Preview's pages, which Vite serves, don't.

## Publishing

Publishing follows the Stack's Deployment (genesis/stack.md): Prepare installs dependencies and
tools (`npm run deploy:prepare`), then Build, Migrate and Start (`scripts/serve.sh`).

- **Sandbox allowances (a human step):** the Deployment asks for `gvisor` and `fuse`. The workspace
  owner approves them once on the project's **Production** page, and Publish waits until they do.
- **The first Publish on a host** installs the tools and builds the toolbox (15 to 25 minutes).
  Later ones keep them in the app's own home and take seconds unless a tool changed.
- **Secrets:** Vibe64 generates `AUTH_LOCAL_SESSION_SECRET`, `MERCBOT_VAULT_KEY` and the first
  account's setup code (`AUTH_LOCAL_SETUP_CODE`) once, keeps them in Production Env across releases,
  and shows the setup code on the Production page.
- **Going live (a human step):** the published copy stays a test copy until someone switches it to
  Live under **Test copy or Live** on the Production page.

## When a start stops

- **A sentence ending "See README → Hosting requirements."**, such as "This host doesn't let Mercbot
  create its own sandboxes…", "…no FUSE device…" or "…no Xvfb or x11vnc…": the host lacks something
  bots' computers or files need, and Mercbot never starts with them quietly switched off.
  `bash scripts/namespace.sh --check` checks the host alone. On a published copy, check that the
  sandbox allowances are approved.
- **"Mercbot's AI isn't set up."**, then one sentence per setting to add or fix: add those AI
  settings in Env (step 1), then start again.
- **"HOSTING_SCRIPT is …, which doesn't exist"**: `HOSTING_SCRIPT` names a file that isn't there;
  unset it to use `scripts/hosting/vibe64.sh`.
- **Missing or invalid database settings** stop the start with an error. Fix them, then run
  workspace setup again (**Prepare workspace**, or **Retry** on a failed preparation).
- **A tools install cut short** is redone on the next run: a tool counts as installed only once its
  marker is written.

Colleague can explain these steps, and offer to run the ones it may run, such as
`npm run tools:install` or the host check, only after the person asks or accepts. Adding keys,
approving sandbox allowances and going Live are the person's own steps.
