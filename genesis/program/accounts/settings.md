# Self-service account settings

This boundary gives a signed-in person control over their own profile and
personal preferences.

## Sources

- `src/components/account/settings/AccountSettingsBotsSection.vue`

- Main: `src/pages/account/index.vue`
- `src/pages/account/[section].vue`
- `src/placement.js`
- `packages/main/src/client/providers/MainClientProvider.js`
- `src/components/account/settings/AccountSettingsProfileSection.vue`
- `src/components/account/settings/AccountSettingsPreferencesSection.vue`

## Public contract

A Bots section holds the Auto-review switch and the person's
plain-language rules (Action / Behaviour, with inline edit and delete), the same
ones as in Settings → Permissions.


The page sits under JSKIT's top app bar, titled Account settings, with the Up
arrow back the way the person came (or to Mercbot's start, which opens their
home) and the settings' Done action in the bar where Up can't go back (D-64).
Each section is a page of its own, `/account/<section>` (Profile, Preferences,
Bots, Usage), whose parent is the section list at `/account`: on a phone or a
medium window the list leads to one section and Up returns to the list; a wide
window shows the list beside the open section, or beside the first section on
the list's own page.

Signed-in people can view and update their display name, avatar, locale and
format preferences. Avatars are kept on Mercbot's shared files volume, where every server finds
them (`files/files.md`, D-19). Mercbot sends no notification emails, so there are no
notification choices. The account email is visible but
cannot be edited as profile data. Loading preserves the settings layout,
validation remains beside the relevant field, and command failures use shared
feedback without shifting the form.
