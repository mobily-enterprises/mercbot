# Plugins

One folder per integration (docs/architecture.md §3.6, §10). Each `plugin.json`
describes how the integration appears in Connect apps: its name,
category, whether it's added (`add`) or signed in to (`connect`), a one-line
description, colour and icon kind, the connectors it brings, the skills bundled
with it and an information table.

An integration people sign in to adds an `oauth` block: its `provider` (one of
those in `packages/integrations/src/server/oauth.js`) and the `scopes` it needs.
Accounts then connect through this copy's own registered app for that provider, or
through the hub this copy is linked to (D-31). Adding a folder is all it
takes to list a new integration.

An app whose maker hosts its own connection point for AI assistants (a remote MCP
server) adds an `mcp` block instead, and signs in through the general connector
(D-34, `packages/integrations/src/server/connector.js`): its `url`, the action
whose answer names who signed in (`whoami`, its first email address labels the
account), and the actions that tell other people (`sends`, only simulated by a
test copy). `scopes` overrides the access the app asks for, and `env` names this
copy's own registered app in Env (`<ENV>_CLIENT_ID`, `<ENV>_CLIENT_SECRET`) for an
app that doesn't let Mercbot register itself. Everything else, the sign-in and the
actions, comes from the app. Its `skill.md` is the app's guidance for bots: a
`name:`, `description:` and `source:` head (the maker's documentation it was
written from), then `---` and the guidance.

An app that connects with API credentials someone makes in the app itself, with no sign-in for other apps, adds a
`credentials` block (D-93, `packages/integrations/src/server/credentials.js`): its `kind` (one of the kinds the
integrations package builds; `sedna` is the only one), `home: true` when the credentials are the whole home's (added,
entered and changed by its owners and admins only), the `button` that opens the form, the `help` that says where to
make them, a `page` link to that place (`{tenant}` is filled from the typed address), and the form's `fields`, each
with an `id`, a `label` and optionally `secret`, `prefix`, `suffix`, `hint`, `optional` and `maxLength`. Connect apps
shows the form in place of a sign-in, the kind checks the values with the app before they're saved, and its
`skill.md` is the app's guidance for bots, as above.
