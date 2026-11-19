# Connect apps and skills

Lists the integrations Mercbot offers, lets a person add or remove them and
their accounts, and keeps the private skills their bots have made.

## Sources

- Main: `packages/integrations/src/server/IntegrationsFeature.js`
- `packages/integrations/src/server/integrationsService.js`
- `packages/integrations/src/server/registerRoutes.js`
- `packages/integrations/src/server/signInPage.js`
- `packages/integrations/src/server/types.js`
- `packages/integrations/src/server/catalogue.js`
- `packages/integrations/src/server/connections.js`
- `packages/integrations/src/server/oauth.js`
- `packages/integrations/src/server/connector.js`
- `packages/integrations/src/server/connectorAccounts.js`
- `packages/integrations/src/server/tokenRenewal.js`
- `packages/integrations/src/server/unlinking.js`
- `packages/integrations/package.json`
- `plugins/README.md`
- `migrations/20261113120000_baseline.cjs`
- `src/components/mercbot/MercbotAppsModal.vue`
- `src/components/mercbot/useAppAccounts.js`
- `src/components/mercbot/usePrivateSkill.js`
- `src/components/mercbot/appsCatalogue.js`
- `src/components/mercbot/useSignInWatch.js`
- `src/components/mercbot/useConnectApps.js`
- `src/components/mercbot/MercbotConnectExplainer.vue`
- `src/components/mercbot/pluginsApi.js`
- `src/pages/account/connect.vue`
- `src/components/mercbot/MercbotSettingsLink.vue`
- `packages/integrations/src/server/accounts.js`
- `packages/integrations/src/server/credentials.js`
- `packages/integrations/src/server/sednaCredentials.js`
- `packages/integrations/src/server/appPeople.js`
- `packages/integrations/src/server/tableResources.js`
- `migrations/20261119150000_plugin_account_people.cjs`
- `src/components/mercbot/MercbotCredentialsForm.vue`
- `src/components/mercbot/MercbotAppPeople.vue`
- `src/components/mercbot/MercbotCredentials.css`
- `plugins/sedna/plugin.json`
- `plugins/sedna/skill.md`
- `tests/server/sednaCredentials.integration.js`
- `tests/support/fakeSedna.mjs`
- `tests/e2e/sedna.spec.ts`
- `plugins/calendly/plugin.json`
- `plugins/notion/plugin.json`
- `plugins/todoist/plugin.json`
- `tests/server/connections.integration.js`
- `tests/server/connector.integration.js`
- `tests/support/fakeMcpServer.mjs`
- `tests/client/appsCatalogue.vitest.js`
- `tests/e2e/connector.spec.ts`

## Public contract

The catalogue is read at startup from `plugins/<id>/plugin.json`.

**Connect apps belongs to the current home** (D-37). Its routes are under `/api/w/:workspaceSlug`
(written `…` below), and JSKIT supplies the person's rights in that home.

**Who reaches which accounts.** A person reaches their own accounts (`workspace_id` null) and the
home's (`workspace_id` set). In a shared bot's room, only the home's are reached.

**Routes:**
- `GET …/plugins`: the catalogue with each plugin's added state and the reachable accounts. A
  home's account has `home: true` and `addedBy`. Private skills and `managesHome` come with it.
- `POST …/plugins/:pluginId/install`: adds the app for the person, with a default account that
  needs sign-in.
- `DELETE …/plugins/:pluginId`: removes the app and the person's own accounts; the home's stay.
- `POST …/plugins/:pluginId/accounts {name, home}`: adds a labelled account and returns its
  `accountId`. With `home: true` it belongs to the home; only owners and admins may (403
  otherwise).
- `GET …/plugin-accounts/:accountId`: one account as the list shows it, after finishing its
  sign-in through the hub when there is one; 404 for an account the person doesn't reach.
- `PATCH …/plugin-accounts/:accountId`: renames an account.
- `DELETE …/plugin-accounts/:accountId`: removes a home's account (owners and admins), or the person's own while it isn't connected and the app keeps another account.
- `PATCH /api/skills/:skillId` and `DELETE /api/skills/:skillId` (skills stay personal).
- Changing a home's account (rename, sign in, disconnect, remove) needs `workspace.settings.update`.

**Signing in.**
- Sign-in opens `/account/connect?plugin=<id>&home=<slug>&account=<id>` in a new tab.
- That tab asks `POST …/plugin-accounts/:accountId/connect` for the provider's consent screen and
  goes there.
- `DELETE …/plugin-accounts/:accountId/connection` disconnects.
- Connect apps checks that account every few seconds (`GET …/plugin-accounts/:accountId`) and
  shows how it stands, until it shows as connected; for an app that lists its own actions (D-34) it then
  reads the whole list once, which brings its **Tools**.

**Account rows.**
- A row reads "label · address"; the first account has no label, just its address.
- A home's account also says "Everyone in <home> · added by <name>", the person's display name,
  else their email's first part (as chats name people). Members see its status only.
- "+ Add another account" asks for a label. Owners and admins also choose "Just me"
  or "Everyone in <home>".
- Without the app added for themselves, owners and admins see "+ Add an account for everyone in
  <home>".
- Removing a home's account asks "Remove it for everyone?".

**Copies reached only on their own machine** (`APP_PUBLIC_URL` on localhost or 127.0.0.1,
such as Preview or a home server):
- `GET …/plugins` says `pasteSignIn: true`.
- An account that needs signing in shows a box for the address the sign-in tab ended on.
- `POST …/connections/finish` (`{ address }`) finishes it, only for that address and for the
  person's own sign-in.

**Files in the person's own Drive or OneDrive**:
- `list_drive_files` shows the newest five (more only when the person names a number).
- `create_drive_document` makes a Google Doc from simple HTML, or for OneDrive a Word file made with the word app, at the top level, with no approval card.
- `bin_drive_file` moves a file to the bin (restorable for 30 days), never a permanent delete. Google Drive is signed in with full Drive access (D-42); a drive connected before that can only change files Mercbot made until it's signed in again.
- The rest of each drive (search, folders, details and sharing, reading, downloading and exporting, making, changing, moving, copying, sharing, Google's comments) is in `driveTools.js` (see bots/conversations).
- Files shown or made appear as a `drive_files` card: logo, name as a link, kind, date.
- A reply that talks about Drive files without one of these tools running is sent back once (the same kind of check as the calendar's).

**Tools**:
- A plugin's `actions` list names the bot tools that work with it. A grouped tool's actions are listed one by one as `tool.action` (D-42), so Gmail shows 24 rows, Google Drive 19 and GitHub 52.
- A connected app's page shows "N of N enabled". It opens to a switch per action (`PUT …/plugins/:pluginId/actions/:actionId {enabled}`, stored in `plugin_actions_off` per person and app).
- `integrations.toolSwitches(reach)` gives each reply the apps to skip per tool, the tools to drop when every connected app has them off, and the switched-off actions in words. The bot is told not to do those on the app's website either.

**Account states:**
- `sign_in_state` is `started` when a sign-in begins and `failed` when it's cancelled or refused; it's cleared on success or disconnect.
- Rows show Connected, or Needs auth with Sign in, Reconnect or Retry.
- The installed overview shows each app's worst state, its parts ("1 connector, 2 skills"), and six apps before "Show all N plugins".

**Sign-in pages:**
- A cancelled sign-in says nothing was connected.
- A work account whose organisation must approve first gets a copyable approval link for IT: Microsoft admin consent, or Google's admin console with the client ID.
- Every page links back to Mercbot.

**Naming accounts:**
- When a tool spans several apps (calendar: Google and Outlook), accounts are listed as "App: label · address", in the apps' order, Google first.
- The bot can name an account by its app ("the Google one"), with or without the address.
- "My calendar" picks the person's own address, and the first app's account when one address is in two apps.
- Calendars set to UTC use and name the person's own zone.

**Apps that host their own connection point** (D-34, the general connector: the app's sign-in and actions in
`connector.js`, its accounts' keys in `connectorAccounts.js`):
- A plugin's `mcp` block names its address (`url`), the action whose answer's first email labels the
  account (`whoami`), the actions that tell other people (`sends`, simulated in a test copy, D-69), and
  optionally `scopes` and `env` (the copy's own registered app, `<ENV>_CLIENT_ID`/`_SECRET`, for an app without
  self-registration). Its `skill.md` (after `---`) is the app's `guide` for bots.
- The first sign-in finds everything from the app (MCP authorization): an unsigned call answers 401
  naming its description (RFC 9728), which must describe that very address and names its sign-in server
  (RFC 8414, path insertion and OpenID fallbacks); a server without PKCE (S256) is refused, and so is any
  description, sign-in server or endpoint not on https when the app's own address is (a description's
  redirect is followed only to such an address, and an MCP call follows none). Every request to the app and
  its sign-in server (discovery, registration, code exchange, renewal, withdrawal, MCP calls, each redirect)
  goes through `publicFetch`, which connects only to public addresses (`@local/account/public-address`):
  one written as a private address (10.0.0.1, [::1], 169.254.169.254) or a name leading to one is refused,
  in discovery as `integrations_connector_discovery_failed` naming it. Mercbot then
  registers itself there as a public client (RFC 7591) and keeps it, sealed, in `connector_apps` (one row
  per app, read by every server on each use, D-15). A copy whose return address changed, or an app whose connection
  point in its `plugin.json` changed, is found and registered again; a sign-in refused with
  `invalid_client` drops the row so the next registers again. Scopes in `mcp.scopes` (Calendly's) win
  over what the app's description lists.
- Every copy signs in directly (never through the hub), with PKCE and the app's address as `resource`
  (RFC 8707) on the consent screen, the code exchange and every renewal; the same callback, sign-in pages
  and account rows as Google's. Right after a sign-in the app's actions are listed and stored in
  `connector_apps.tools`, which is what **Tools** shows (`{ id, name, reads }`); none until someone connects.
- `integrations.connectors`: `apps()` (the catalogue's `mcp` entries), `actions(reach, accountId)` (the
  app's MCP tools for that account, kept 10 minutes per server, less the switched-off ones, named in `off`)
  and `use(reach, accountId, name, input)` (`{ text, isError }`; 403 `integrations_connector_action_off`
  for a switched-off one). Each is one short Streamable HTTP conversation (initialize, then the request,
  JSON or server-sent events, then the session is ended).
- Keys: a key about to run out is renewed first, a key the app refuses (401/403) is renewed once and tried
  again; a renewal refused (`invalid_grant`, or none possible) signs the account out (Needs auth, label kept)
  with 409 `integrations_connector_signed_out`. A renewal holds the account's row lock
  (`accounts.withLockedAccount`): of two servers renewing at once, the second takes the first's new key, as
  Notion and Todoist take each refresh key once (D-15). Disconnecting withdraws the sign-in at the app too, where it
  offers revocation.

**Connect card:** an app Mercbot can't connect to yet still gets its card, with an "Ask for it" button that opens the app's page.

**Bots.** Bot tools reach accounts through `integrations.reachableAccounts(reach, options, filters)`
(only the connected accounts of the tool's apps) and `connections.accessToken(reach, id)`, and
name and draw apps from the catalogue (`integrations.app`, `appName`, `appNamed`) without reading
any table. A home's account is named "(the home's)" in the bot's current state. The bots hear of
each account that turns connected through `connections.whenConnected(listener)`: a sign-in's callback
(`finishSignIn`) and a hub's sign-in found by `syncPending` save the account and tell each listener
`{ pluginId, userId, homeId }` (homeId null for a person's own) inside one transaction
(`accounts.savedConnected`), so a listener that fails rolls the sign-in back with it, and each listener's answer
runs once that has committed (the bots' connect follow-ups, D-77).

Connected accounts and the bridge (D-31): a plugin's `oauth` block names its
provider (`google`, `microsoft`, `github` in `oauth.js`) and scopes. With the
copy's own registered app in Env (`<PROVIDER>_CLIENT_ID`/`_SECRET`, or `_TEST_`
ones while `APP_PUBLIC_URL` is local), a copy signs people in directly; every
provider returns to the public `GET /api/connections/callback`, which answers with a
small page. Without one, a copy linked to a hub (`MERCBOT_HUB_URL`, another Mercbot that connects accounts for it;
no default, and without it Settings says none is set up and linking refuses) borrows the hub's app: the hub keeps the
long-lived permission and the copy fetches hourly keys, calling the provider itself. Linking is Settings → Mercbot
account (`POST /api/bridge/link`, `POST /api/bridge/link/check`; its status and unlinking are asked from the current
home, `GET/DELETE /api/w/:workspaceSlug/bridge/link`): the copy asks the hub for a link request
(`POST /api/bridge/link-requests`), the person approves its code at the hub's approval address, and the copy claims its
install token once (`POST /api/bridge/link-requests/:id/claim`). It then calls the hub's
`POST /api/bridge/connections`, `GET /api/bridge/connections/:ref`, `POST /api/bridge/connections/:ref/token`,
`DELETE /api/bridge/connections/:ref` and `DELETE /api/bridge/install` with `Authorization: Bearer <install token>`
(`createHttpHub` in `connections.js`). Mercbot itself is no hub: it keeps no linked copies. A feature that is one lends
this copy's registered apps through the optional capability `mercbot.integrations.bridged-sign-ins` (`BridgedSignIns`
in `types.js`): `connections.startBridgedSignIn(pluginId, connectionFor)` refuses an app this copy has no registered
app for (409 `integrations_hub_sign_in_unset`) or that hosts its own connection point, asks the feature for its bridge
connection and starts the sign-in for it (`oauth_states.bridge_connection_id`); the callback asks the feature which
app that connection is for (`pluginOf`, none once it's gone or when no feature keeps them, which refuses the sign-in)
and hands it the label and the sealed tokens (`signedIn`); `connections.bridgedToken(pluginId, sealedTokens, save)`
answers an hourly key, renewing it, and handing the renewed tokens sealed to `save`, when it ran out. Tokens are
sealed with `MERCBOT_VAULT_KEY`. Bot tools get a key with
`connections.accessToken(userId, accountId)` from the `mercbot.integrations` output.
Its `acrossHomes` is for whoever runs the copy and reads in the feature's own system context, which reaches every home:
`accountsOf(userId, options)` lists every account a person added, their own and the homes', in the order they were
added, each with its app, name, label, status, `home` (home-wide or personal), `workspaceId` and `connectedAt`, never
its keys; `disconnect(accountId, options)` disconnects any account by its id as its owner's disconnect does (the app's
sign-in withdrawn, at the hub too when it borrowed the hub's, then its keys, label and status cleared), answers what it
disconnected, and refuses an id no account has with 404 `integrations_account_not_found`.
A key from a direct sign-in that is about to run out (less than a minute left) is renewed
holding the account's row lock (`tokenRenewal.js`, `accounts.withLockedAccount`, D-15): of two servers renewing at
once, the second takes the first's new key, so the provider is asked once. A renewal the
provider refuses (`invalid_grant`: access withdrawn, or a testing app's week ran out) signs the
account out (Needs auth) with 409 `integrations_sign_in_ran_out`; any other failure is 502
`integrations_renewal_failed` and leaves it signed in. `connections.accessToken(reach, id, options, {refused})`
also renews a key the provider turned down before it ran out (`refused`, D-80), under the same lock and only while
it's still the saved key, so of several servers that saw it turned down one asks the provider; it answers `renewed`
when this call asked. A home's files kept in Google Drive get their keys this way (D-80). Outside staging and production only (`APP_ENV`, D-87), `MERCBOT_TEST_GOOGLE_DRIVE_URL` makes the
stand-in Drive (`tests/support/fakeDrive.mjs`) Google's sign-in for connected accounts too
(`standInGoogle` in `IntegrationsFeature.js`), for the Test Preview.

Unlinking (D-31) signs out every account that borrowed the hub's sign-in, in every home. The person who
linked the copy may unlink it; so may the owners and admins (`workspace.settings.update`) of a home that
person is an active member of (`workspaces.memberships`), asking from that home, or of any home once the
linker's account is gone (`linked_by` null). Anyone else gets 403 `integrations_unlink_forbidden` (`unlinking.js`);
the status says `canUnlink`, and Settings asks before unlinking. An unlink from a home is recorded in that
home's Activity trail through `mercbot.apps`' `activity.record` (via `settings`, `changes.unlinkedCopy`).

**Apps connected with a home's API credentials** (D-93): a plugin's `credentials` block names its `kind`
(`credentials.js`; Sedna's is `sednaCredentials.js`), the `fields` of its form (`id`, `label`, `secret`, `prefix`,
`suffix`, `hint`, `optional`, `maxLength`), `help`, a `page` link (`{tenant}` filled from the typed address) and
`home: true`, which makes its account the home's. Only owners and admins add such an app (`POST …/plugins/:pluginId/install`
answers a member 403 `integrations_home_app_forbidden`, and makes one home account however many add it), add its accounts
(only for the home: 409 `integrations_home_account_only`), enter its credentials and disconnect it.
- `POST …/plugin-accounts/:accountId/credentials {fields…}` checks the values with the app before saving anything:
  each declared field (400 `integrations_credentials_field_missing`, `_long`), the kind's `normalize` (Sedna: the
  tenant one DNS label, 400 `integrations_sedna_tenant_invalid`), a key (`mint`: 400 `integrations_credentials_refused`
  for a wrong ID or secret, 400 `integrations_sedna_tenant_unknown` for no such organisation) and `check` (Sedna:
  `GET /company/me`, whose name labels the account, and the home's people matched by email address, the first 50, five
  at a time). It then seals `{ values, access, expiresAt }` in `plugin_accounts.tokens`, marks the account connected
  (`accounts.connectedHere`, which tells `whenConnected` listeners), and answers `{ credentials: { app, label, matched,
  unmatched, more }, plugins, skills }`.
- `connections.accessToken` makes a key from the credentials when the saved one is about to run out or was refused,
  under the account's row lock (`tokenRenewal.js`, the kind's `mint` in place of a refresh); it answers `api`, the
  address the key is for, built from the credentials alone (Sedna: `https://<tenant>.sednanetwork.com/platform/2019-01-01`).
  The app turning the credentials down signs the account out with 409 `integrations_credentials_missing`. A sign-in,
  here or through the hub, is refused with 409 `integrations_credentials_only`; disconnecting clears the credentials.
- Outside staging and production only (`isStagingOrProduction`, D-87), `MERCBOT_TEST_SEDNA_URL` points every tenant at
  the stand-in Sedna (`tests/support/fakeSedna.mjs`, `credentialKinds` in `IntegrationsFeature.js`), for the Test
  Preview.

**Who each person is at such an app** (`appPeople.js`, `plugin_account_people`, kept to the home):
- `GET …/plugin-accounts/:accountId/people/me`: the call's person, `{ app, person, via }` with `person` their app user
  and teams and `via` `email` or `picked`, or `person: null` with `asked` (their pick waiting), `taken` (the user their
  address finds is confirmed for someone else) or `gone` (their confirmed user archived or deleted). A confirmed pick
  comes first, then the one active user with their sign-in address (`homeDirectory` in `IntegrationsFeature.js`).
- `GET …/app-users?q=`: the app's active users whose name or address holds the words (two letters at least), for
  picking oneself.
- `PUT …/people/me {appUserId}`: picks one's own user when one's address finds none (409
  `integrations_app_person_matched` otherwise); 404 `integrations_app_user_unknown` for no such active user, 409
  `integrations_app_user_taken` for one another person of the home has by address or is confirmed as. It waits as
  `asked`, unless the person is an owner or admin, whose pick is `confirmed` at once.
- `GET …/people` (owners and admins): the home's people with who each is; `POST …/people/:userId/confirm` confirms a
  waiting pick, checked again (404 `integrations_app_person_not_asked`); `DELETE …/people/:userId` forgets a pick, one's
  own (`me`) or, for owners and admins, anyone's. No two people are confirmed as one user of one organisation (a unique
  index), and a pick holds only for the organisation (`org`, Sedna's tenant) it was made in.
