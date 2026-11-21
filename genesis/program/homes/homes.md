# Homes

Homes (D-36): everything belongs to a home, even with one person in it. Homes are JSKIT workspaces; Mercbot adds the
first home's name and the person's homes on screen. Nobody is invited into a home here: JSKIT serves no invitation
routes (`config/public.js`), and a copy built on Mercbot that serves many people turns them on in
`config/extensions.js` and brings its own invitation email, people screen and removal checks.

## Sources

- Main: `packages/homes/src/server/HomesFeature.js`
- `packages/homes/src/server/HomeChangesFeature.js`
- `src/components/mercbot/MercbotShell.vue`
- `src/components/mercbot/useTeam.js`
- `src/components/mercbot/MercbotNewHomeDialog.vue`
- `packages/homes/src/server/firstHomeName.js`
- `packages/homes/src/server/personName.js`
- `packages/homes/src/server/homeOf.js`
- `config/public.js`
- `config/extensions.js`
- `config/roles.js`
- `config/server.js`
- `src/components/mercbot/homesApi.js`
- `src/components/mercbot/MercbotHomeName.vue`

## Public contract

- **First home:** a new account gets "<First name>'s home", where they're the
  owner. Anyone can create more homes. New home (the home switcher, `MercbotNewHomeDialog.vue`) asks only the home's
  name (D-109); Create home makes it and opens it on the person's welcome chat, where the main bot asks what the home is
  for and whether anyone else will use it (`genesis/program/bots/onboarding.md`).
- **Renaming (D-103):** a home's owners and admins rename it in Settings → General (`MercbotHomeName.vue`), on JSKIT's
  own `PATCH /api/w/<home>` (`workspace.workspaces.update`, which needs `workspace.settings.update`): a member is
  refused 403, someone outside the home 404, as JSKIT answers any workspace they aren't in (as one that isn't there),
  and an empty name or one over 160 characters 400 (`homesApi.js` `HOME_NAME_MAX`, `homeNameProblem`). `rename` keeps the name the server answered in the list of homes, so the sidebar
  and the switcher show it at once; JSKIT reports the change, so everyone else in the home gets `home-changed` (Live
  changes). Signing in again never renames a first home.
- **People's names:** where the others in a home see someone (who added a home's
  account, who wrote in a chat, who made a bot, a template's maker), they're named by their display name, else their
  email's first part; a chat keeps the name someone wrote under once they've left (R2).
- **Roles:** owner (one per home, can't be changed or removed), admin and member, as `config/roles.js` names them;
  the home switcher shows each home's role.
- **Invitations off:** `workspaceInvitations` is off, so JSKIT serves none of `/api/w/<home>/invites` or
  `/api/workspace/invitations/*` (404); a home's people (`/api/w/<home>/members`) and roles stay readable to its
  people. JSKIT still asks how long an invitation would last (`workspaceMembers.defaults.inviteExpiresInMs`).
- **Configuration extension:** `config/extensions.js`, empty here, is merged last into `config/public.js`,
  objects key by key, anything else replaced. A copy built on Mercbot replaces it whole.
- **People in a home:** `homesApi.js` reads a home's whole list of people (JSKIT answers a page at a time; the page
  reads every page, 100 at a time, `peopleApi.members`) for Team, New chat's To: and a chat's Add people
  (`useTeam.js`), read again when its people change (`homeChanges`), and offers the parts a copy's own people screen
  builds on (`homeRoute`, `homeList`, `sendJsonApi`, `readJsonApi`, `attributesOf`). When a home's people change, the
  bots seat whoever joined in the home's everyone chat and take whoever left out of every chat
  (`genesis/program/bots/chats.md`).
- **No mail:** Mercbot sends no email of its own (a person's own copy invites and registers nobody) and keeps no
  outbox. A copy built on Mercbot that sends email brings its own
  mail delivery.
- **Live changes:** when a home's people or its name change, everyone with a
  membership row in it (including someone just removed) gets a `home-changed`
  notice on their bot events stream, from any server. A page open in that home
  starts again if the person's own role changed or they were removed (then it
  shows the not-yours card); otherwise the home list refreshes.
- **Isolation:** every bot, file and computer route is under `/api/w/<home>/`,
  and a request for something in another home answers not found.

## Proved by

- `tests/server/homeRename.integration.js`
- `tests/client/homeName.vitest.js`
- `tests/client/homePeople.vitest.js`
- `tests/e2e/home-rename.spec.ts`
- `tests/e2e/new-home.spec.ts`
- `tests/server/homes.integration.js`
