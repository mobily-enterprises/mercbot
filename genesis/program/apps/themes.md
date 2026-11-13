# Themes

How a home's apps look: a theme from fixed choices (D-35, owner 2026-10-29: apps only, never
Mercbot's own look), and each app's own CSS on top, with complete freedom (owner, 2026-10-30).

## Sources

- Main: `packages/apps/src/shared/theme/index.js`
- `packages/apps/src/server/apps.js`
- `src/components/apps/AppTheme.vue`
- `src/components/apps/AppsLook.vue`
- `src/components/apps/AppDetailsPanel.vue`
- `tests/server/appsTheme.test.js`
- `packages/apps/src/server/appStyle.js`
- `src/components/apps/useAppStyle.js`
- `tests/server/appStyle.test.js`

## Public contract

- A home's theme (`app_themes`): colour, mode (light, dark, system), font, corners, spacing and a
  logo (PNG, JPEG or WebP data URL up to 200 KB); an app may override colour and spacing
  (`apps.theme`). A colour under 3:1 contrast against the page it's used on is refused.
- `GET/PUT /api/w/:slug/apps-theme` and `PUT /api/w/:slug/apps/:app/theme` (owners and admins).
  App and public pages get the effective theme and draw it through a Vuetify theme and defaults.
- An app's own CSS (owner, 2026-10-30): the definition's `style`, checked when a draft is saved
  (`checkStyle`: parses; only @media, @supports, @container, @keyframes, @font-face, @layer; no
  url() except data:image and fonts.gstatic.com font files; no expression/javascript:/behavior;
  no selector starting with a combinator; at most 60,000 characters) and served fenced
  (`scopeStyle`: every selector under `[data-app-style="<app id>"]`, `:root`/`html`/`body` meaning
  that area, which gets `contain: paint`; animation and font names prefixed with the app's id).
  The app's area is its navigation and screens (not Mercbot's bar) and, on a public page, the
  whole page; it carries `data-screen`. Parts are `.app-node--<type>`, plus `.x-<name>` for each
  name in a part's `class`; dialogs open inside the area.

