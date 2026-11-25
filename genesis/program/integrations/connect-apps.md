# Connect apps and skills

Lists the integrations Mercbot offers, lets the people of a home add or remove them and
the home's accounts, and keeps the private skills their bots have made.

## Sources

- Main: `packages/integrations/src/server/IntegrationsFeature.js`
- `packages/integrations/src/server/integrationsService.js`
- `packages/integrations/src/server/registerRoutes.js`
- `packages/integrations/src/server/signInPage.js`
- `packages/integrations/src/server/types.js`
- `packages/integrations/src/server/catalogue.js`
- `packages/integrations/src/server/connections.js`
- `packages/integrations/src/server/githubApp.js`
- `packages/integrations/src/server/githubAccess.js`
- `packages/integrations/src/server/signInBinding.js`
- `packages/integrations/src/server/hubLink.js`
- `packages/integrations/src/server/oauth.js`
- `packages/integrations/src/server/connector.js`
- `packages/integrations/src/server/connectorAccounts.js`
- `packages/integrations/src/server/tokenRenewal.js`
- `packages/integrations/src/server/unlinking.js`
- `packages/integrations/src/server/departures.js`
- `packages/integrations/package.json`
- `plugins/README.md`
- `migrations/20261113120000_baseline.cjs`
- `src/components/mercbot/MercbotAppsModal.vue`
- `src/components/mercbot/MercbotGithubRepoPick.vue`
- `src/components/mercbot/useAppAccounts.js`
- `src/components/mercbot/usePrivateSkill.js`
- `src/components/mercbot/appsCatalogue.js`
- `src/components/mercbot/useSignInWatch.js`
- `src/components/mercbot/useConnectApps.js`
- `src/components/mercbot/MercbotConnectExplainer.vue`
- `src/components/mercbot/MercbotAddAccount.vue`
- `src/components/mercbot/signInReturn.js`
- `src/components/mercbot/pluginsApi.js`
- `src/pages/account/connect.vue`
- `src/components/mercbot/MercbotSettingsLink.vue`
- `packages/integrations/src/server/accounts.js`
- `packages/integrations/src/server/credentials.js`
- `packages/integrations/src/server/sednaCredentials.js`
- `packages/integrations/src/server/appPeople.js`
- `packages/integrations/src/server/tableResources.js`
- `migrations/20261119150000_plugin_account_people.cjs`
- `migrations/20261120020000_sign_in_binding.cjs`
- `src/components/mercbot/MercbotCredentialsForm.vue`
- `src/components/mercbot/MercbotAppPeople.vue`
- `src/components/mercbot/MercbotCredentials.css`
- `plugins/sedna/plugin.json`
- `plugins/sedna/skill.md`
- `migrations/20261119181000_one_unlabelled_home_account.cjs`
- `migrations/20261121225000_unlabelled_home_accounts_of_home_apps.cjs`
- `migrations/20261121230000_accounts_belong_to_homes.cjs`
- `plugins/calendly/plugin.json`
- `plugins/notion/plugin.json`
- `plugins/todoist/plugin.json`
- `packages/integrations/src/server/appRequests.js`
- `migrations/20261119220000_request_pace.cjs`
- `src/components/mercbot/MercbotRequestPace.vue`

## Public contract

The catalogue is read at startup from `plugins/<id>/plugin.json`.

**Connect apps belongs to the current home** (D-111). Its routes are under `/api/w/:workspaceSlug`
(written `…` below), and JSKIT supplies the person's rights in that home.

**Every account is its home's** (D-111). `plugin_accounts.workspace_id` is required, and every read is scoped to the
call's home (`accounts.reachable`, which refuses a system context): everyone in the home, and every bot there, reaches
every account of it, in any chat. `user_id` is who added it. The apps on the home's list are `home_plugins` (home, app,
who added it, when; unique per home and app). The person's own parts stay theirs: private skills and the app interest
noted by Request. The Tools switches (`plugin_actions_off`) are the home's, as its accounts are. An app connected
with the home's API credentials, such as Sedna, is used in any chat as the person who asked (D-93, D15, R4,
`packages/bots/src/server/accountTools.js`).

**Routes:**
- `GET …/plugins`: the catalogue with each plugin's `installed` (on the home's list) and `canRemove`, and the home's
  accounts, each with `addedBy` (the adder's name, as chats name people), `addedByYou` and `canChange`. Private skills
  and `managesHome` come with it.
- `POST …/plugins/:pluginId/install` (**Add to this home**, **Add** in the catalogue): puts the app on the home's list
  (`home_plugins`, as added by the person; a second add finds the first) and makes no account, except for an app whose
  API credentials are the home's (its one home account, below). It never signs in: the client then opens the Add
  account step (D-110).
- `DELETE …/plugins/:pluginId` (**Remove from this home**): withdraws every account of the app in the home
  (`connections.withdraw`), then deletes them and the app's row. Allowed for the home's owners and admins, and for the
  person who added the app while every account of it is one they added (`mayRemoveApp`); else 403
  `integrations_home_app_remove_forbidden` ("Only the home's owners and admins can remove <app> from the home while it
  has accounts someone else added.").
- `POST …/plugins/:pluginId/accounts {name}`: adds an account of the home, added by the person, its label optional
  (empty, it's shown by its address), puts the app on the home's list too, and returns its `accountId`. Anyone in the
  home may, except for an app whose API credentials are the home's (403 `integrations_home_app_forbidden`).
- `GET …/plugin-accounts/:accountId`: one account as the list shows it, after finishing its
  sign-in through the hub when there is one; 404 for an account of another home.
- `PATCH …/plugin-accounts/:accountId`: renames an account.
- `DELETE …/plugin-accounts/:accountId` (the line's bin): any account the person may change, connected or not, the
  first or only one included. It withdraws the sign-in first (`connections.withdraw`: the app's own revocation where it
  offers one, and the hub of a borrowed one), then deletes; a Sedna account's people matches go with it. The app stays on
  the home's list.
- `PATCH …/skills/:skillId` and `DELETE …/skills/:skillId`: a private skill is its person's in
  the home it's open in (D-112), so another home's skill of theirs answers 404 there (`tests/server/skillRoutes.integration.js`).
- `PUT …/plugin-accounts/:accountId/pace {pace}`: the account's Request pace, `gentle`, `normal` or `fast` (400
  otherwise), answering the list.
- Changing an account (rename, sign in, remove, its pace) is for the person who added it and the home's owners and
  admins (`workspace.settings.update`), `accounts.mayChange`; anyone else gets 403
  `integrations_account_manage_forbidden` ("Only the person who added this account and the home's owners and admins
  can change it."). There is no route that moves an account between a person and a home (D-110's `PUT
  …/plugin-accounts/:accountId/home` is gone: 404).

**Signing in** (D-110). In Connect apps one control starts a sign-in: the Add account step's **Sign in with <Google,
Microsoft, GitHub or the app>**, or a line's own Sign in again (hidden while the step is open). Nothing else does.
- Sign-in opens `/account/connect?plugin=<id>&home=<slug>&account=<id>`: on a computer in a popup window
  (`noopener`); on a phone's width (`signInInThisTab`, under 600 px) in the same tab, through the router (so the
  browser's Back from the provider comes back to Mercbot), which first leaves its way back
  (`mercbot-sign-in-back`, the page with `?connect=<id>`) in session storage.
- That page leaves its own address (`mercbot-sign-in-again`) for Try again, asks `POST …/plugin-accounts/:accountId/connect`
  for the provider's consent screen and goes there. Each provider shows its account chooser (Google
  `prompt=select_account consent`, Microsoft and GitHub `select_account`), with the account's address suggested when it
  has one (`login_hint`, GitHub's `login`).
- Signing a line in again keeps it the same account: `finishSignIn` (and the hub path's `syncPending`) refuses an
  address other than the one it has, compared without case, with 409 `integrations_sign_in_different_account`: "This
  <app> account is <address>, but you signed in as <other>, so nothing changed. To connect <other>, use + Add
  account.", leaving it as it was.
- There is no disconnecting that keeps an account: the bin removes it. Whoever runs the copy still disconnects any
  account (`acrossHomes.disconnect`, below).
- The shell answers sign-in windows on the `BroadcastChannel` "mercbot-sign-in" (`listenForSignIns`), so a window that
  connected closes itself, and Connect apps reads the account at once; it also checks it every few seconds
  (`GET …/plugin-accounts/:accountId`) until it shows as connected; for an app that lists its own actions (D-34) it then
  reads the whole list once, which brings its **Tools**. Back in the same tab, `?connect=<id>` opens Connect apps on the
  app.

**An app's page** shows its description, accounts, Request pace and Tools, then **What your bots learn** (its skills'
descriptions; their and its connectors' code names are in View source) and the Information table.

**Account lines** (`accountLine`, D-110). The same for every app, the first line included.
- A line reads "label · address", or the address alone; before its first sign-in, the label or "Not signed in yet".
- Who uses it, in words (`sharedWith`): "Everyone in <home>, and their bots, can read and send from <address>." for a
  mailbox (Gmail, Outlook), "… can use <address>." for any other app, then "Added by <name>." or "Added by you.".
- Its status, and, only where `canChange`, rename, the button it needs (Sign in again for a line with an address, else
  Sign in, Reconnect or Retry) and a bin, which asks "Remove it for everyone in <home>? Their bots stop using it.".
  Request pace's choices follow `canChange` too.
- **+ Add account** opens the Add account step (`MercbotAddAccount.vue`, `addAccountStep`): a label (optional), the
  same sentence for "the account you connect", a note on what opens ("A Google window opens so you can pick the
  account.", or on a phone "Google's sign-in opens here, then brings you back."), Cancel, and **Sign in with Google**,
  never disabled for want of a label. A bot's connect card's **Connect** opens what connecting means above the same
  step (`MercbotConnectExplainer.vue`).
- **Remove from this home** shows only where `canRemove`, and asks first (`removeAppQuestion`): "Remove Gmail from
  <home>, with its account? Everyone's bots stop using it.".

**Someone who leaves takes their accounts** (D-111, `departures.js`). The feature listens on `runtime.events` for
JSKIT's `entity.changed` of a home's members (published after the change is saved, the removal among them) and, in a
job context in that home, reads its active members, withdraws (`connections.withdraw`) and deletes every account
someone no longer in it added, and records each in the home's Activity trail through `mercbot.apps`' `activity.record`
(actor Mercbot, via `settings`, `changes.departedAccount: { app, account, person }`; Apps' Activity reads "removed
<app> <account>, which <person> connected, as they're no longer in the home"). It reads the home as it is, so any end
of a membership is covered; a failure is logged and done at the home's next change of people. The apps they added stay.
Nothing here refuses a removal: a Drive holding the home's files goes too (D-80's `storage.heldInTheirDrive` counts the
Drive accounts the person added, for a host that refuses such a removal first).

**Copies reached only on their own machine** (`APP_PUBLIC_URL` on localhost or 127.0.0.1,
such as Preview or a home server):
- `GET …/plugins` says `pasteSignIn: true`.
- An account that needs signing in shows a box for the address the sign-in tab ended on.
- `POST …/connections/finish` (`{ address }`) finishes it, only for that address and for the
  person's own sign-in.

**Files in the home's Google Drive or OneDrive accounts**:
- `list_drive_files` shows the newest five (more only when the person names a number).
- `create_drive_document` makes a Google Doc from simple HTML, or for OneDrive a Word file made with the word app, at the top level, with no approval card.
- `bin_drive_file` moves a file to the bin (restorable for 30 days), never a permanent delete. Google Drive is signed in with full Drive access (D-42); a drive connected before that can only change files Mercbot made until it's signed in again.
- The rest of each drive (search, folders, details and sharing, reading, downloading and exporting, making, changing, moving, copying, sharing, Google's comments) is in `driveTools.js` (see `genesis/program/bots/bot-tools.md`).
- Files shown or made appear as a `drive_files` card: logo, name as a link, kind, date.
- A reply that talks about Drive files without one of these tools running is sent back once (the same kind of check as the calendar's).

**Tools**:
- A plugin's `actions` list names the bot tools that work with it. A grouped tool's actions are listed one by one as `tool.action` (D-42), so Gmail shows 24 rows, Google Drive 19 and GitHub 52.
- A connected app's page shows "N of N enabled". It opens to a switch per action (`PUT …/plugins/:pluginId/actions/:actionId {enabled}`, stored in `plugin_actions_off` per home, app and action; the home's owners and admins change them, since they hold
for everyone's bots in every chat: 403 otherwise).
- `integrations.toolSwitches(options)` gives each reply the apps to skip per tool, the tools to drop when every connected app has them off, and the switched-off actions in words. The bot is told not to do those on the app's website either.

**Account states:**
- `sign_in_state` is `started` when a sign-in begins and `failed` when it's cancelled or refused; it's cleared on success.
- Lines show Connected, Needs more access, or Needs sign-in with Sign in again, Sign in, Reconnect or Retry.
- The installed overview shows each app's worst state as words (Connected, Needs sign-in, or No account yet), its parts
  ("1 connector, 2 skills"), and six apps before "Show all N plugins"; a row opens the app, and starts no sign-in.
- Private skills follow it, with "Open a skill to change its name, description or instructions." once there is one. Skills
  (the shell's, `openSkills`) opens the modal on this page (`startPage: "manage"`) scrolled to them.
- Opened again, the modal reads the list while it shows the one it had, so it's usable at once (`load`). What changed
  meanwhile is newer than that read and stays when it lands: the apps an answer gave (Request's, Connect's, a
  sign-in's, a switch's), and the private skills once one is saved or deleted (`tests/e2e/connector.spec.ts`).

**Sign-in pages** (`signInPage.js`, D-110): a title and a sentence, then one main button and a small **Back to
Mercbot** (the way back of a same-tab sign-in, else `/`).
- Connected: "Connected to <provider>", **Close**. In its own window it tells the shell's tabs and closes itself once
  one answers; in Mercbot's own tab it goes straight back.
- Not connected: "Couldn't connect" and why, **Try again** (the sign-in's start, from session storage; else Close).
- A work account whose organisation must approve first gets a copyable approval link for IT: Microsoft admin consent, or Google's admin console with the client ID.
- **Close** calls `window.close()`; a window the browser keeps (one a page didn't open) shows "You can close this tab
  now." 300 ms later instead. Only a path on this site is followed. The script is served at
  `/api/connections/sign-in-page.js`, for a Content Security Policy without inline scripts.
- `/account/connect`'s problem page has Close: it closes the sign-in's window, or, in a tab the sign-in took (a
  phone), replaces the page with where the sign-in began (`takeWayBack`), through the router.

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
- `integrations.connectors`: `apps()` (the catalogue's `mcp` entries), `actions(accountId, options)` (the
  app's MCP tools for that account, kept 10 minutes per server, less the switched-off ones, named in `off`)
  and `use(accountId, name, input, options)` (`{ text, isError }`; 403 `integrations_connector_action_off`
  for a switched-off one). Each is one short Streamable HTTP conversation (initialize, then the request,
  JSON or server-sent events, then the session is ended).
- Keys: a key about to run out is renewed first, a key the app refuses (401/403) is renewed once and tried
  again; a renewal refused (`invalid_grant`, or none possible) signs the account out (Needs auth, label kept)
  with 409 `integrations_connector_signed_out`. A renewal holds the account's row lock
  (`accounts.withLockedAccount`): of two servers renewing at once, the second takes the first's new key, as
  Notion and Todoist take each refresh key once (D-15). Removing an account withdraws the sign-in at the app too, where
  it offers revocation.

**Request pace** (D-96, `appRequests.js`): every request to a connected account's app goes through the account's own
`fetch`, which integrations makes: `connections.accessToken` answers it beside the key (`fetch`), and the bots' keys,
the general connector's actions and listings, a credentials kind's reads and the home's Drive storage use it.
- Each plugin that reaches a service declares the service's published limit, `limits: { requests, seconds, source,
  says }` in plugin.json (one a second when none is declared). An account's `pace` (`plugin_accounts.pace`, null for
  every account that never chose one, which is Gentle) takes a share of it: Gentle a tenth, Normal four tenths, Fast nine
  tenths; half that share may go at once and the rest is spread evenly over the limit's window (a turn every
  `seconds / (share / 2)`, rounded up to a whole millisecond, as the turn is kept).
- An account's next turn is `plugin_account_turns.next_at`, one row per account, taken under the row's lock
  (`lockOrCreate`), so every server's requests share it (D-15); a request then waits its turn. One more than 20 s off is
  refused with `AppBusyError` (503 `integrations_app_busy`, `{ app, seconds }`, "Sedna is busy: try again in 24 s.
  Nothing was done.").
- A busy answer (429 or 529; 503 with Retry-After; 403 with Retry-After, or with no requests left until the window's
  reset; Google's 403 rate-limit reasons) moves the account's next turn past the wait it names (5 s when it names none,
  an hour at most). A wait of 10 s or less is waited out once, in turn; a longer one, or a second busy answer, is
  `AppBusyError`. A 503 to a change is answered to its caller and never sent again.
- `PUT …/plugin-accounts/:accountId/pace` (`integrations.choosePace`) changes it: the person who added the account and
  the home's owners and admins (403 for anyone else, 404 for an account of another home). The app's page shows **Request pace** with
  a choice per connected account (`MercbotRequestPace.vue`); the list's accounts carry `pace` (`gentle` when unset).
- A general connector's session handshake (initialize, initialized, ending the session) is the protocol's own and goes
  unpaced; making a key (sign-in, renewal, a credentials kind's `mint`) is too.

**Connect card:** an app Mercbot can't connect to yet still gets its card, with an "Ask for it" button that opens the app's page.

**Bots.** Bot tools reach the home's accounts through `integrations.reachableAccounts(options, filters)`
(only the connected accounts of the tool's apps) and `connections.accessToken(id, options)`, and
name and draw apps from the catalogue (`integrations.app`, `appName`, `appNamed`) without reading
any table. The bot's current state names who connected each account ("connected by them", or by <name>,
`integrations.namesOf`); a mailbox someone else connected shows its bot no sign-in codes or links (D-111,
`genesis/program/bots/bot-tools.md`). The bots hear of
each account that turns connected through `connections.whenConnected(listener)`: a sign-in's callback
(`finishSignIn`) and a hub's sign-in found by `syncPending` save the account and tell each listener
`{ pluginId, userId, homeId }` inside one transaction
(`accounts.savedConnected`), so a listener that fails rolls the sign-in back with it, and each listener's answer
runs once that has committed (the bots' connect follow-ups, D-77).

Connected accounts and the bridge (D-31): a plugin's `oauth` block names its
provider (`google`, `microsoft`, `github` in `oauth.js`) and scopes. With the
copy's own registered app in Env (`<PROVIDER>_CLIENT_ID`/`_SECRET`, or `_TEST_`
ones while `APP_PUBLIC_URL` is local), a copy signs people in directly; every
provider returns to the public `GET /api/connections/callback`, which answers with a
small page (its approval page's Copy button is `GET /api/connections/sign-in-page.js`, so the page has no inline
script). A sign-in belongs to the browser that started it (D-97, `signInBinding.js`): `POST
…/plugin-accounts/:accountId/connect` gives that browser a cookie of its own, `mercbot_sign_in_<first 16 characters of
the state>`, HttpOnly, SameSite=Lax, path the callback's, Secure at an https address, 15 minutes, and
`oauth_states.binding` keeps only its sha256. The callback finishes a sign-in only when its request brings that cookie
back, and clears it; from any other browser it answers 400 `integrations_sign_in_other_browser` before anything is
taken or saved, so the sign-in stays for its own browser. A pasted address (`connections/finish`) is tied to the
signed-in person who owns the account instead. Without one, a copy linked to a hub (`MERCBOT_HUB_URL`, another Mercbot that connects accounts for it;
no default, and without it Settings says none is set up and linking refuses) borrows the hub's app: the hub keeps the
long-lived permission and the copy fetches hourly keys, calling the provider itself. Linking is Settings → Mercbot
account (`POST /api/bridge/link`, `POST /api/bridge/link/check`; its status and unlinking are asked from the current
home, `GET/DELETE /api/w/:workspaceSlug/bridge/link`): the copy asks the hub for a link request
(`POST /api/bridge/link-requests`), the person approves its code at the hub's approval address, and the copy claims its
install token once (`POST /api/bridge/link-requests/:id/claim`). It then calls the hub's
`POST /api/bridge/connections`, `GET /api/bridge/connections/:ref`, `POST /api/bridge/connections/:ref/token`,
`DELETE /api/bridge/connections/:ref` and `DELETE /api/bridge/install` with `Authorization: Bearer <install token>`
(`createHttpHub` in `hubLink.js`, which keeps the link too). Mercbot itself is no hub: it keeps no linked copies. A
feature that is one lends this copy's registered apps through the optional capability
`mercbot.integrations.bridged-sign-ins` (`BridgedSignIns` in `types.js`):
`connections.startBridgedSignIn(pluginId, { connectionFor, lentTo })` refuses an app this copy has no registered
app for (409 `integrations_hub_sign_in_unset`) or that hosts its own connection point, asks the feature for its bridge
connection and starts the sign-in for it (`oauth_states.bridge_connection_id`), for `lentTo`, the account the linked
copy is linked to (`oauth_states.lent_to`, D-97). It answers this server's page `/account/connect?lent=<state>`, not
the consent screen: that person begins it there signed in (`POST /api/connections/lent/begin {state}`,
`beginLentSignIn`), which gives their browser the sign-in's cookie and answers the consent screen and the app's name;
anyone else gets 403 `integrations_sign_in_other_account`, an unknown or old state 400
`integrations_sign_in_link_expired`, and beginning again moves the sign-in to the browser that did. The copy's own
browser keeps nothing: `connect` answers only the hub's `url`. The callback asks the feature which
app that connection is for (`pluginOf`, none once it's gone or when no feature keeps them, which refuses the sign-in)
and hands it the label and the sealed tokens (`signedIn`); `connections.bridgedToken(pluginId, sealedTokens, save)`
answers an hourly key, renewing it, and handing the renewed tokens sealed to `save`, when it ran out. Tokens are
sealed with `MERCBOT_VAULT_KEY`. Bot tools get a key with
`connections.accessToken(accountId, options)` from the `mercbot.integrations` output.
Its `acrossHomes` is for whoever runs the copy and reads in the feature's own system context, which reaches every home:
`accountsOf(userId, options)` lists every account a person added, in every home, in the order they were
added, each with its app, name, label, status, `workspaceId` and `connectedAt`, never
its keys; `disconnect(accountId, options)` disconnects any account by its id, the safety action people themselves no
longer have (D-110): the app's sign-in withdrawn as a removal's is, at the hub too when it borrowed the hub's, then its
keys, label and status cleared, so its line shows Sign in and its bin; it answers what it disconnected, and refuses an
id no account has with 404 `integrations_account_not_found`.
A key from a direct sign-in that is about to run out (less than a minute left) is renewed
holding the account's row lock (`tokenRenewal.js`, `accounts.withLockedAccount`, D-15): of two servers renewing at
once, the second takes the first's new key, so the provider is asked once. A renewal the
provider refuses (`invalid_grant`: access withdrawn, or a testing app's week ran out) signs the
account out (Needs auth) with 409 `integrations_sign_in_ran_out`; any other failure is 502
`integrations_renewal_failed` and leaves it signed in. `connections.accessToken(id, options, {refused})`
also renews a key the provider turned down before it ran out (`refused`, D-80), under the same lock and only while
it's still the saved key, so of several servers that saw it turned down one asks the provider; it answers `renewed`
when this call asked. A home's files kept in Google Drive get their keys this way (D-80). Outside staging and production only (`APP_ENV`, D-87), `MERCBOT_TEST_GOOGLE_DRIVE_URL` makes the
stand-in Drive (`tests/support/fakeDrive.mjs`) Google's sign-in for connected accounts too
(`standInGoogle` in `IntegrationsFeature.js`), for the Test Preview. It is signed in to with the copy's own Google app
(`GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, as `credentials` picks them), and takes only the client it knows
(`STAND_IN_GOOGLE_CLIENT` unless started with another), as Google does: without the app nothing is renewed, and one it
doesn't know is refused `invalid_client`, each 502 `integrations_renewal_failed` with the account left signed in. A
computers server renews a Drive home's key the same way (D-131, `tests/server/serverRoles.integration.js`).

**GitHub through the copy's GitHub App** (D-128, `githubApp.js`, `githubAccess.js`): with `GITHUB_APP_ID`,
`GITHUB_APP_SLUG` and `GITHUB_APP_PRIVATE_KEY` (PEM, or with `\n` for line breaks; the `GITHUB_TEST_APP_` ones on a
local copy when set, `githubAppSettings`), `GITHUB_CLIENT_ID`/`_SECRET` are the App's client and signing in to GitHub
is the App's user-to-server sign-in: a `ghu_` key for 8 hours, renewed with its `ghr_` key like any other
(`tokenRenewal.js`), seeing only what both the person and the App reach. `finishSignIn` reads the App's
installations the person reaches (`GET /user/installations`) and keeps them in the account's sealed tokens
(`installations: [{ id, account, accountType, all }]`, kept across renewals by `oauth.js` `stored`). When there are
none, the callback's page says "Next, install Mercbot's GitHub App on GitHub and choose the repositories your bots may work on.
Each bot still asks you before it uses one." with **Install on GitHub** (`signInPage`'s `next`, which keeps the page
open). The App's Setup URL, public `GET /api/connections/github/installed`, answers a static page ("Mercbot's GitHub App is
installed on GitHub", or "The repositories Mercbot's GitHub App reaches are changed" for `setup_action=update`). It never uses its
`installation_id`, which anyone could send. A single-user copy lets it through without the key's cookie, which
SameSite=Strict keeps from a redirect off github.com (`gate.js`). Connect apps shows an App-signed account's
`github: { reaches: [{ account, all }], chooseUrl }` ("Mercbot's GitHub App is on …" with **Choose repositories**, or "isn't
installed on GitHub yet" with **Install on GitHub**). An account signed in before the App (a `gho_` key) reads as
before: `lacksAccess` is true for it, so it shows **Sign in again**, and signing in again goes through the App.
- `connections.github` (`createGithubAccess`) is a person's own GitHub for bots' commands: only the call's person's
  own connected GitHub accounts in the call's home that were signed in through the App (`ownAccounts`; every home
  account is everyone's for reading, D-111, but a key that pushes acts as its person). Refusals: 409
  `integrations_github_app_unset` (no App), `integrations_github_sign_in_again` (only accounts from before the App, or
  GitHub turned the key down) and `integrations_github_not_connected`. `repository(options, owner/name)` answers `{
  repository: { id, fullName, private, write, defaultBranch }, accountId }` as their own key sees it (`write` from
  their push, maintain or admin), or null. `repositories(options, { words, after })`, behind `GET
  /api/w/:workspaceSlug/github/repositories?q=&after=`, answers a page of 20 of their repositories in the App's
  installations whose owner/name holds the words, `next` (an opaque place: account, installation, page and entry)
  and `installUrl`. Each request reads at most 5 of GitHub's pages of 100, so a person with thousands of
  repositories gets an answer at once, and it keeps the installations it read with the account's tokens.
  `commandKey(repository)` makes the App's installation key for that repository alone: the App's JWT (RS256, issued a
  minute early, 9 minutes), `GET /repos/{owner}/{name}/installation` (409 `integrations_github_not_installed`), then
  `POST /app/installations/{id}/access_tokens` with `repository_ids: [id]` and `permissions`. Those are Contents,
  Pull requests and Issues write with Actions, Checks, Statuses and Metadata read where the person can push, all read
  otherwise, and never Workflows. GitHub's answer must reach exactly that repository, or the key is withdrawn and 502
  `integrations_github_key_too_wide`. The key lasts at most an hour (GitHub's limit), and `revoke` withdraws it
  (`DELETE /installation/token`). The private key never leaves this module.
- A copy linked to a hub has no App key, so its bots' commands can't push (not built).

Unlinking (D-31) signs out every account that borrowed the hub's sign-in, in every home. The person who
linked the copy may unlink it; so may the owners and admins (`workspace.settings.update`) of a home that
person is an active member of (`workspaces.memberships`), asking from that home, or of any home once the
linker's account is gone (`linked_by` null). Anyone else gets 403 `integrations_unlink_forbidden` (`unlinking.js`);
the status says `canUnlink`, and Settings asks before unlinking. An unlink from a home is recorded in that
home's Activity trail through `mercbot.apps`' `activity.record` (via `settings`, `changes.unlinkedCopy`).

**Apps connected with a home's API credentials** (D-93): a plugin's `credentials` block names its `kind`
(`credentials.js`; Sedna's is `sednaCredentials.js`), the `fields` of its form (`id`, `label`, `secret`, `prefix`,
`suffix`, `hint`, `optional`, `maxLength`), `help`, a `page` link (`{tenant}` filled from the typed address) and
`home: true`, which makes its credentials the whole home's. Only owners and admins add such an app (`POST …/plugins/:pluginId/install`
answers a member 403 `integrations_home_app_forbidden`, and makes one home account however many add it, even at the
same moment: the partial unique index `ix_plugin_accounts_home_app_unlabelled` on `(workspace_id, plugin_id)` where
`name` is empty, for these apps only (D-110; other apps' home accounts may all go unlabelled), makes the second add
lose the insert race and find the first, D-94), add its accounts (a second one needs a label, 400
`integrations_account_label_missing`), enter its credentials (403 `integrations_home_app_forbidden` for anyone else) and
remove it with its bin, which forgets its people matches too; **Change credentials** enters new ones.
- `POST …/plugin-accounts/:accountId/credentials {fields…}` checks the values with the app before saving anything:
  each declared field (400 `integrations_credentials_field_missing`, `_long`), the kind's `normalize` (Sedna: the
  tenant one DNS label, 400 `integrations_sedna_tenant_invalid`), a key (`mint`: 400 `integrations_credentials_refused`
  for a wrong ID or secret, 400 `integrations_sedna_tenant_unknown` for no such organisation) and `check` (Sedna:
  `GET /company/me`, whose name labels the account, and the home's first 50 people matched by email address: the
  organisation's users a hundred a request when they fill no more pages than there are people, else one person at a
  time, each in the account's Request pace). It then seals `{ values, access, expiresAt }` in `plugin_accounts.tokens`, marks the account connected
  (`accounts.connectedHere`, which tells `whenConnected` listeners), and answers `{ credentials: { app, label, matched,
  unmatched, more }, plugins, skills }`.
- `connections.accessToken` makes a key from the credentials when the saved one is about to run out or was refused,
  under the account's row lock (`tokenRenewal.js`, the kind's `mint` in place of a refresh); it answers `api`, the
  address the key is for, built from the credentials alone (Sedna: `https://<tenant>.sednanetwork.com/platform/2019-01-01`).
  The app turning the credentials down signs the account out with 409 `integrations_credentials_missing`. A sign-in,
  here or through the hub, is refused with 409 `integrations_credentials_only`; removing the account deletes the credentials.
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

## Proved by

- `tests/server/githubApp.test.js`
- `tests/server/githubAccess.integration.js`
- `tests/server/sednaCredentials.integration.js`
- `tests/e2e/sedna.spec.ts`
- `tests/server/connections.integration.js`
- `tests/server/signInBinding.test.js`
- `tests/server/connector.integration.js`
- `tests/client/appsCatalogue.vitest.js`
- `tests/server/accountWorkflow.integration.js`
- `tests/server/signInReturn.test.js`
- `tests/e2e/accounts.spec.ts`
- `tests/e2e/connector.spec.ts`
- `tests/server/appRequests.test.js`
- `tests/server/requestPace.integration.js`
- `tests/server/accountsBelongToHomes.integration.js`
- `tests/server/departedAccounts.integration.js`
- `tests/server/connectAppsReads.integration.js`
