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
- Table `database` `default` `bot_messages`
- Table `database` `default` `bot_sections`
- Table `database` `default` `bot_routines`
- Table `database` `default` `user_plugins`
- Table `database` `default` `plugin_accounts`
- Table `database` `default` `user_skills`
- Table `database` `default` `bot_policies`
- Table `database` `default` `approval_rules`

## `accounts` Accounts and authentication

Owns local authentication and self-service profiles through installed JSKIT packages.

### Source

- Directory `src/pages`

### Program

- `genesis/program/authentication/accounts.md`
- `genesis/program/accounts/settings.md`

### Data owned

- Table `database` `default` `auth_local_users`
- Table `database` `default` `auth_local_sessions`
- Table `database` `default` `auth_local_recovery`
- Table `database` `default` `users`
- Table `database` `default` `user_settings`

### Data used

- Nothing.

## `bots` Bots and conversations

Owns each person's bots, their conversation timeline, scripted onboarding and
DeepSeek replies, run on the agent loop of the installed JSKIT agent packages, whose tables it
owns through them.

### Source

- Directory `packages/bots`

### Program

- `genesis/program/bots/conversations.md`
- `genesis/program/bots/app-tools.md`
- `genesis/program/bots/templates.md`
- `genesis/program/bots/agent-loop.md`

### Data owned

- Table `database` `default` `bots`
- Table `database` `default` `bot_messages`
- Table `database` `default` `bot_sections`
- Table `database` `default` `bot_routines`
- Table `database` `default` `bot_group_members`
- Table `database` `default` `bot_requests`
- Table `database` `default` `person_memories`
- Table `database` `default` `bot_policies`
- Table `database` `default` `approval_rules`
- Table `database` `default` `bot_conversations`
- Table `database` `default` `conversation_reads`
- Table `database` `default` `bot_notebook`
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

Owns the plugin catalogue (the app's `plugins/<id>/plugin.json` folders), which
plugins each person has added and their accounts, private skills, connected
accounts' tokens, a copy's side of the bridge between copies of Mercbot (D-31), and the general connector to apps
that host their own connection point (D-34).

### Source

- Directory `packages/integrations`

### Program

- `genesis/program/integrations/connect-apps.md`

### Data owned

- Table `database` `default` `plugin_actions_off`
- Table `database` `default` `user_plugins`
- Table `database` `default` `plugin_accounts`
- Table `database` `default` `user_skills`
- Table `database` `default` `oauth_states`
- Table `database` `default` `bridge_link`
- Table `database` `default` `connector_apps`

### Data used

- Table `database` `default` `users`
- Table `database` `default` `workspace_memberships`
- Table `database` `default` `audit_events`

## `computer` Bot computers

Owns each bot's computer: Chrome and the Craft apps in a gVisor desktop sandbox on its own
Xvfb display, with internet only through Mercbot's gateway (D-49), the live screen stream, the person's input during takeover, the
screenshots the bot takes, its coding runs, each in a gVisor sandbox of its own (D-77), and which server runs each computer (D-15).

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

## `files` Bots' files and office apps

Owns the folders bots keep files in (each home's shared folder, each bot's folder for
everyone using it, and each person's own with each bot), the file browsers, the pages bots
write and their sealed viewer (D-74), the sandboxed office apps bots make files with, the bots' command line in gVisor and its toolbox, and the
routes that show, send and change those files (D-20, D-21, D-47), and where each home keeps them: on Mercbot, in its own
WebDAV storage or in a connected Google Drive account, through `mercbot.integrations` (D-26, D-80), moving every file
when a home chooses another place, and answering whose own Drive holds them (`storage.heldInTheirDrive`), which a copy
that removes people from homes asks first. The files volume's metadata lives in the database's `juicefs` schema, managed
by JuiceFS itself.

### Source

- Directory `packages/files`

### Program

- `genesis/program/files/files.md`
- `genesis/program/files/pages.md`
- `genesis/program/files/shell.md`

### Data owned

- Table `database` `default` `file_storage`
- Table `database` `default` `page_versions`
- Table `database` `default` `shell_runs`

### Data used

- Table `database` `default` `bots`
- Table `database` `default` `workspaces`
- Table `database` `default` `bot_conversations`
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
own), the Vault (D-17), the account menu, About and help pages that show them,
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

Owns startup, health checks, and preparation of the application's database.

### Source

- Directory `.`

### Program

- `genesis/program/operations/runtime.md`

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
- Table `database` `default` `bot_conversations`
- Table `database` `default` `workspace_memberships`
