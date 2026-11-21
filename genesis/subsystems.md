# Subsystems

## `application` Application shell

Owns the private home and adaptive navigation around authenticated features.

### Source

- Directory `src/components`

### Program

- `genesis/program/application/home.md`
- `genesis/program/application/shell-navigation.md`

### Data owned

- Nothing.

### Data used

- Table `database` `default` `users`
- Table `database` `default` `bots`
- Table `database` `default` `conversations`
- Table `database` `default` `chat_people`
- Table `database` `default` `messages`
- Table `database` `default` `conversation_sections`
- Table `database` `default` `bot_routines`
- Table `database` `default` `home_plugins`
- Table `database` `default` `plugin_accounts`
- Table `database` `default` `user_skills`
- Table `database` `default` `bot_policies`
- Table `database` `default` `approval_rules`

## `accounts` Accounts and authentication

Owns local authentication and self-service profiles through installed JSKIT packages.

### Source

- Directory `src/pages`

### Program

- `genesis/program/accounts/settings.md`

### Data owned

- Table `database` `default` `auth_local_users`
- Table `database` `default` `auth_local_sessions`
- Table `database` `default` `auth_local_recovery`
- Table `database` `default` `users`
- Table `database` `default` `user_settings`

### Data used

- Nothing.

## `bots` Bots and chats

Owns a home's bots, members of the home as its people are, and its chats (D-112): Public and Private chats of any of
its people and bots, each person's own place in them (read point, pin, section, hidden, muted), the direct chat a
bot's Message opens, the home's everyone chat and an app's chat with its Builder, and the one reading rule every
route and every bot turn reads through (the row policies and `readable_from`). In each chat each bot has a seat
(`chat_bots`) that its reply runs, goal, to-dos, routines, requests and follow-ups hang off, and that the computer,
files, commands, watches and app jobs of other subsystems key to. It owns who speaks and the turns (DeepSeek replies,
run on the agent loop of the installed JSKIT agent packages, whose tables it owns through them), the bots' tools,
Team and each bot's card, Library and archive, bot templates and teams (D-98, D-105), what a bot knows (D-107),
routines run as their maker, and the scripted welcome chat. Its records (`mercbot.bots.records`) are how the other
subsystems read chats, seats and bots.

### Source

- Directory `packages/bots`

### Program

- `genesis/program/bots/chats.md`
- `genesis/program/bots/turns.md`
- `genesis/program/bots/bot-tools.md`
- `genesis/program/bots/team.md`
- `genesis/program/bots/onboarding.md`
- `genesis/program/bots/routines.md`
- `genesis/program/bots/app-tools.md`
- `genesis/program/bots/templates.md`
- `genesis/program/bots/agent-loop.md`
- `genesis/program/bots/knowledge.md`

### Data owned

- Table `database` `default` `bots`
- Table `database` `default` `conversations`
- Table `database` `default` `chat_people`
- Table `database` `default` `chat_bots`
- Table `database` `default` `messages`
- Table `database` `default` `conversation_sections`
- Table `database` `default` `bot_routines`
- Table `database` `default` `bot_requests`
- Table `database` `default` `bot_policies`
- Table `database` `default` `approval_rules`
- Table `database` `default` `bot_knowledge`
- Table `database` `default` `bot_knowledge_parts`
- Table `database` `default` `home_templates`
- Table `database` `default` `home_template_changes`
- Table `database` `default` `connect_follow_ups`
- Table `database` `default` `agent_runs`
- Table `database` `default` `agent_goals`
- Table `database` `default` `agent_summaries`
- Table `database` `default` `agent_summary_queue`
- Table `database` `default` `agent_commands`

### Data used

- Table `database` `default` `users`
- Table `database` `default` `workspaces`
- Table `database` `default` `workspace_memberships`
- Table `database` `default` `app_settings`
- Table `database` `default` `app_jobs`
- Table `database` `default` `app_watches`

## `integrations` Connect apps and skills

Owns the plugin catalogue (the app's `plugins/<id>/plugin.json` folders), which apps each home has added and their
accounts (the home's, used by everyone and every bot in it in any chat, D-111), the home's Tools switches, each
person's private skills and the apps they asked for (Request), connected accounts' tokens, a copy's side of the bridge
between copies of Mercbot (D-31), and the general connector to apps that host their own connection point (D-34).

### Source

- Directory `packages/integrations`

### Program

- `genesis/program/integrations/connect-apps.md`

### Data owned

- Table `database` `default` `plugin_actions_off`
- Table `database` `default` `home_plugins`
- Table `database` `default` `plugin_accounts`
- Table `database` `default` `plugin_account_people`
- Table `database` `default` `plugin_account_turns`
- Table `database` `default` `user_skills`
- Table `database` `default` `app_interest`
- Table `database` `default` `oauth_states`
- Table `database` `default` `bridge_link`
- Table `database` `default` `connector_apps`

### Data used

- Table `database` `default` `users`
- Table `database` `default` `workspace_memberships`
- Table `database` `default` `audit_events`

## `computer` Bot computers

Owns each bot's computer in each chat (D14: one per seat, `chat_bots`, labelled with its bot and chat, used by
everyone who can open the chat, D16: taken over and handed back): Chrome and the Craft apps in a gVisor desktop sandbox on its own
Xvfb display, with internet only through Mercbot's gateway (D-49), the live screen stream, the person's input during takeover, the
screenshots the bot takes, its coding runs, each in a gVisor sandbox of its own (D-77), and which server runs each computer (D-15),
or the one a copy built on Mercbot chooses (`mercbot.computer-placement`, D-85), and who hears when computers run out of room
(`mercbot.computer-events`, D-88).

### Source

- Directory `packages/computer`

### Program

- `genesis/program/computer/bot-computer.md`

### Data owned

- Table `database` `default` `bot_computers`
- Table `database` `default` `mercbot_servers`
- Table `database` `default` `mercbot_settings`
- Table `database` `default` `computer_tickets`
- Table `database` `default` `bot_browser_state`

### Data used

- Table `database` `default` `bots`
- Table `database` `default` `conversations`
- Table `database` `default` `chat_bots`

## `files` Bots' files and office apps

Owns the folders bots keep files in (each chat's folder, each bot's own folder in all its chats and the home's
shared folder, D-112; in a Private chat a bot only reads the wider two unless a person widens the place, D13), the
file browsers, the pages bots
write and their sealed viewer (D-74), the sandboxed office apps bots make files with, the bots' command line in gVisor and its toolbox, and the
routes that show, send and change those files (D-20, D-21, D-47), and where each home keeps them: on Mercbot, in its own
WebDAV storage or in a connected Google Drive account, through `mercbot.integrations` (D-26, D-80), moving every file
when a home chooses another place, and answering whose own Drive holds them (`storage.heldInTheirDrive`), which a copy
that removes people from homes asks first, and the pictures and videos a copy built on Mercbot checks (D-90): uploads and
profile pictures before they're kept, the screenshots a bot's reply shows and the files it saves afterwards, from
`media_checks`, removing later a file such a copy's own review judges (`files.media.remove`), and a folder
of such a copy's own (`store.privateFolder`). Mercbot's own files are kept in an S3 bucket when one is configured, each
sealed, with the files key sealed in the bucket's `.mercbot-files` record (D-91); each server works on a copy in its
files folder.

### Source

- Directory `packages/files`

### Program

- `genesis/program/files/files.md`
- `genesis/program/files/pages.md`
- `genesis/program/files/shell.md`

### Data owned

- Table `database` `default` `file_storage`
- Table `database` `default` `files_keys`
- Table `database` `default` `media_checks`
- Table `database` `default` `page_versions`
- Table `database` `default` `shell_runs`

### Data used

- Table `database` `default` `bots`
- Table `database` `default` `workspaces`
- Table `database` `default` `conversations`
- Table `database` `default` `chat_bots`
- Table `database` `default` `plugin_accounts`

## `websites` A home's own website

Owns publishing pages to the person's own website (D-84): the home's website (a folder a web server already serves,
or S3-compatible storage, and its address), sealed with the vault key, the copies of pages put there, taken away and
following their pages through `mercbot.files`, and the Settings section and Share row that show them. One package and
one client registration, so a composition can leave the whole feature out.

### Source

- Directory `packages/websites`

### Program

- `genesis/program/websites/websites.md`

### Data owned

- Table `database` `default` `home_websites`
- Table `database` `default` `page_publications`

### Data used

- Table `database` `default` `workspaces`
- Table `database` `default` `bots`

## `single-user` A person's own copy

Owns D-81's single-user copy: the key, the gate in front of every request and websocket, signing the one person in,
and naming them as who runs the copy (`mercbot.copy-runners`). Its Program also explains `scripts/mercbot`, the command that runs the copy on a person's own computer, whose
source is in `operations`' directory.

### Source

- Directory `packages/single-user`

### Program

- `genesis/program/single-user/single-user.md`

### Data owned

- Nothing.

### Data used

- Table `database` `default` `auth_local_users`
- Table `database` `default` `auth_local_sessions`

## `notices` Notices between servers

Owns the news that travels between Mercbot servers through PostgreSQL `NOTIFY`,
so open pages on any server hear about changes made on another (D-15).

### Source

- Directory `packages/notices`

### Program

- `genesis/program/notices/notices.md`

### Data owned

- Nothing.

### Data used

- Nothing.

## `account` Account menu services

Owns usage (every AI call, picture, computer's day and command, D-73, with what each AI call cost at its provider),
the meter around that work and the recorder that counts it, which a copy built on Mercbot may replace
(`mercbot.usage-recorder`), the spending reports (D-76), the archive of old usage, Mercbot's three kinds of AI and
their providers (D-16, D-72), who runs this copy (whom `mercbot.copy-runners` names: Mercbot's one person, or a copy built on Mercbot's
own), the Vault (D-17), the check a copy built on Mercbot may make of every picture and video (`mercbot.media-check`, its
guard and the sniffer of what a file is, D-90; the Vault's photos are checked here), the account menu, About and help
pages that show them,
and Settings' sections, the account menu, Settings → General and help, to which a copy built on Mercbot may add
its own or, for a Settings section, put one in the place of Mercbot's (extensions.js).

### Source

- Directory `packages/account`

### Program

- `genesis/program/account/account-menu.md`

### Data owned

- Table `database` `default` `usage_events`
- Table `database` `default` `usage_daily`
- Table `database` `default` `usage_monthly`
- Table `database` `default` `computer_days`
- Table `database` `default` `usage_jobs`
- Table `database` `default` `vault_items`

### Data used

- Table `database` `default` `bots`
- Table `database` `default` `users`
- Table `database` `default` `workspaces`
- Table `database` `default` `workspace_memberships`

## `operations` Runtime operations

Owns startup, health checks, and preparation of the application's database, and the configuration that keeps
JSKIT's local accounts for a copy built on Mercbot while Mercbot's one person needs none
(`config/public.js`, `server/lib/runtimeEnv.js`).

### Source

- Directory `.`

### Program

- `genesis/program/operations/runtime.md`
- `genesis/program/authentication/accounts.md`

### Data owned

- Nothing.

### Data used

- Table `database` `default` `auth_local_users`
- Table `database` `default` `auth_local_sessions`
- Table `database` `default` `auth_local_recovery`
- Table `database` `default` `users`
- Table `database` `default` `user_settings`

## `homes` Homes

Owns homes (D-36): the JSKIT workspaces every bot, file and computer belongs to, their memberships and roles, and the
first home's name. Nobody is invited into a home here: invitations are off, and a copy built on Mercbot turns them on
in `config/extensions.js`. Other subsystems scope their routes to `/api/w/<home>/` and store the home's id on
their rows.

### Source

- Directory `packages/homes`

### Program

- `genesis/program/homes/homes.md`

### Data owned

- Table `database` `default` `workspaces`
- Table `database` `default` `workspace_memberships`
- Table `database` `default` `workspace_settings`
- Table `database` `default` `workspace_invites`

### Data used

- Table `database` `default` `users`

## `apps` Apps

Owns each home's mini-apps (D-35): the tables and fields its Builder bot makes, the records
everyone and every bot shares, the audit of every change, the app definitions with their drafts
and versions, the screens that run them, bots' watches and the tasks they queue for bots, and
public screens and the visitor access that fences them, who may use what, how apps look, templates, and scripts with the
web addresses they may call. Records are stored with json-rest-api's AnyAPI, one tenant per
home; nothing is ever deleted.

### Source

- Directory `packages/apps`

### Program

- `genesis/program/apps/data.md`
- `genesis/program/apps/apps.md`
- `genesis/program/apps/screens.md`
- `genesis/program/apps/automation.md`
- `genesis/program/apps/public.md`
- `genesis/program/apps/permissions.md`
- `genesis/program/apps/themes.md`
- `genesis/program/apps/templates.md`
- `genesis/program/apps/scripts.md`
- `genesis/program/apps/views.md`
- `genesis/program/apps/practice.md`

### Data owned

- Table `database` `default` `app_settings`
- Table `database` `default` `app_tables`
- Table `database` `default` `app_fields`
- Table `database` `default` `apps`
- Table `database` `default` `app_versions`
- Table `database` `default` `app_pins`
- Table `database` `default` `audit_events`
- Table `database` `default` `app_watches`
- Table `database` `default` `app_jobs`
- Table `database` `default` `app_themes`
- Table `database` `default` `app_scripts`
- Table `database` `default` `app_script_runs`
- Table `database` `default` `app_script_rounds`
- Table `database` `default` `app_web_access`
- Table `database` `default` `app_practices`
- Table `database` `default` `any_records`
- Table `database` `default` `any_links`
- Table `database` `default` `any_resource_configs`
- Table `database` `default` `any_field_configs`
- Table `database` `default` `any_relationship_configs`

### Data used

- Table `database` `default` `workspaces`
- Table `database` `default` `users`
- Table `database` `default` `bots`
- Table `database` `default` `conversations`
- Table `database` `default` `chat_bots`
- Table `database` `default` `workspace_memberships`
