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
- `migrations/20261114090000_apps_made_by_user.cjs`
- `src/components/apps/AppsHome.vue`
- `src/components/apps/AppDetailsPanel.vue`
- `src/components/apps/FieldRemoval.vue`
- `src/components/apps/MercbotAppsEntry.vue`
- `src/components/apps/MercbotAppsSection.vue`
- `tests/server/appsCheck.test.js`
- `tests/server/appsVersions.integration.js`
- `tests/server/appsRemoval.test.js`
- `tests/server/appsRemoval.integration.js`

## Public contract

- An app has a slug, name, icon, colour, a live version and at most one draft. Definitions are
  stored by ids and handed out by names, so a renamed field shows its new name in every version.
- `saveDraft` runs the save check (catalog parts and settings, screens and navigation, typed CEL
  formulas, filters that can become SQL, limits) and returns errors with their place and a
  suggestion, or stores the draft. `publish` and `restore` are people's actions: the draft (or an
  old version) becomes the next numbered live version, and publishing clears the draft's practice
  copy in the same transaction (practice.md). Creation and publishing are audited.
- One Builder bot per home (`app_settings.builder_bot_id`); each person pins up to 8 apps.
- `mercbot.apps`' `activity.record(entry, options)` adds another feature's entry (`{ actor, via, action,
  changes }`) to the call's home's Activity trail: an unlinked copy (integrations, D-31) is `via.kind`
  `settings`, shown as "Settings".
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
