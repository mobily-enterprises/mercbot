# Apps and versions

A home's mini-apps as stored definitions: drafts checked before saving, versions a person
publishes and can restore, and fields removed from every app in one save (D-35).

## Sources

- Main: `packages/apps/src/server/apps.js`
- `packages/apps/src/shared/check.js`
- `packages/apps/src/shared/definitions.js`
- `packages/apps/src/shared/removal.js`
- `packages/apps/src/server/AppsFeature.js`
- `packages/apps/src/server/appsRuntime.js`
- `packages/apps/src/server/registerRoutes.js`
- `packages/apps/src/server/types.js`
- `packages/apps/src/server/appsRepository.js`
- `packages/apps/src/server/appIcon.js`
- `packages/apps/src/shared/appIcons.js`
- `migrations/20261206120000_apps_picture.cjs`
- `src/components/apps/AppTile.vue`
- `src/components/apps/AppIconPicker.vue`
- `src/components/apps/appIconChoices.js`
- `migrations/20261114090000_apps_made_by_user.cjs`
- `src/components/apps/AppsHome.vue`
- `src/components/apps/AppDetailsPanel.vue`
- `src/components/apps/FieldRemoval.vue`
- `src/components/apps/MercbotAppsEntry.vue`
- `src/components/apps/MercbotAppsSection.vue`
- `src/components/mercbot/MercbotSettingsMainBot.vue`

## Public contract

- An app has a slug, name, icon, colour, a live version and at most one draft. Definitions are
  stored by ids and handed out by names, so a renamed field shows its new name in every version.
- `saveDraft` runs the save check (catalog parts and settings, screens and navigation, typed CEL
  formulas, filters that can become SQL, limits) and returns errors with their place and a
  suggestion, or stores the draft. `publish` and `restore` are people's actions: the draft (or an
  old version) becomes the next numbered live version, and publishing clears the draft's practice
  copy in the same transaction (practice.md). Creation and publishing are audited.
- One Builder bot per home (`app_settings.builder_bot_id`), else its main bot, the home's first (`apps.builder`, D-122); each
  person pins up to 8 apps.
  The home's owners and admins choose it in Settings → Main bot and Builder (`MercbotSettingsMainBot.vue`, D-119);
  a bot's card shows a Builder chip, and its Apps section lists only its watches.
- Every bot knows what apps and their tables are and that only the Builder makes them (D-122): its instructions say,
  after its template and additions, that a request for a database, a table, an app or a tracker that should stay up to
  date goes to the Builder and is never made a spreadsheet or document instead, unless the person directly asks for
  one. Its state note names the Builder (or says none is set, pointing to Settings → Main bot and Builder). A bot that
  isn't the Builder offers a `start_room` card for a private room with the person, itself and the Builder, with a brief
  from the conversation (bot-tools.md); other bots still read and write existing tables' records.
- `mercbot.apps`' `activity.record(entry, options)` adds another feature's entry (`{ actor, via, action,
  changes }`) to the call's home's Activity trail: an unlinked copy (integrations, D-31) and an account removed with
  the person who connected it (integrations, `changes.departedAccount`, D-111) are `via.kind` `settings`, shown as
  "Settings" (`AppsActivity.vue`).
- `mercbot.apps`' `acrossHomes` reads every home the options reach (a system context's; a request's reads its own):
  `madeBy(userId, limit, options)`, the apps a person made, newest first, retired ones left out, each with its home
  and `publicAt`; `publicCounts(workspaceIds, options)`, how many public apps each home has, in one statement.
- `fieldImpact` lists every app version that uses a field and which list filters would widen;
  `removeField` marks the field obsolete (data kept), gives each affected app a new version
  without it (drafts rewritten), audits it once, then retires the field in AnyAPI.
- Routes under `/api/w/:workspaceSlug/apps` (list with pins and Builder, `pins`, `builder`,
  `:slug`, `:slug/publish`, `:slug/versions`, `:slug/restore`) and
  `app-data/fields/:id/impact|remove`. Versions come 50 at a time, newest first, without their
  definitions: `{ versions, more }`, and `before=<version id>` asks for the next page ("Older versions").
- `kind` is `app`, or `view` for the read-only ones any bot saves at once (views.md); `saveDraft`, `publish`
  and `setPublic` refuse a view. `saveDraft` turns a view part's `copy` into the app's own screen.

- An app's or a view's picture (D-141): `apps.icon`, one of `APP_ICON_NAMES` (135 Material Symbols pictures, the 15
  older names among them; `createApp` draws an unknown one as `apps`), and `apps.color`, set by anyone in the home
  (`appIcon.js` `set`, `PUT …/apps/:slug/icon`: 400 `apps_icon_unknown`, `apps_color_invalid`, `apps_icon_nothing`;
  audited as `changes.icon`); or `apps.picture`, a bot's picture kept with the home's Database files
  (`putPicture`: a PNG, JPEG, GIF or WebP by its bytes, else 400 `apps_icon_not_picture`, and a colour given with it
  in the same change; the one it replaces removed), set by the Builder's `app_set_icon` and taken away when a set
  picture is chosen. `AppTile.vue` draws every tile; a public app's visitors see its set picture, since a bot's
  picture is the home's file. `AppIconPicker.vue` (16 `APP_COLOURS`, pictures by group with search, Ask the Builder
  to draw one) opens from the app's details and each tile's menu; on a tile with a bot's picture no set picture is
  chosen, so changing only the colour keeps it (`appIconChoices.js` `startingLook`, `lookToSave`).

## Proved by

- `tests/server/appsRules.test.js`
- `tests/server/appsCheck.test.js`
- `tests/server/appsVersions.integration.js`
- `tests/server/appsRemoval.test.js`
- `tests/server/appsRemoval.integration.js`
- `tests/server/appsIcons.integration.js`
- `tests/client/appIconChoices.vitest.js`
