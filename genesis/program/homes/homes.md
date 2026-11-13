# Homes

Homes (D-36): everything belongs to a home, even with one person in it. Homes are JSKIT workspaces; Mercbot adds the
first home's name and the person's homes on screen. Nobody is invited into a home here: JSKIT serves no invitation
routes (`config/public.js`), and a copy built on Mercbot that serves many people turns them on in
`config/extensions.js` and brings its own invitation email, people screen and removal checks.

## Sources

- Main: `packages/homes/src/server/HomesFeature.js`
- `packages/homes/src/server/HomeChangesFeature.js`
- `src/components/mercbot/MercbotShell.vue`
- `src/components/mercbot/useRooms.js`
- `packages/homes/src/server/firstHomeName.js`
- `packages/homes/src/server/personName.js`
- `packages/homes/src/server/homeOf.js`
- `config/public.js`
- `config/extensions.js`
- `config/roles.js`
- `config/server.js`
- `src/components/mercbot/homesApi.js`

## Public contract

- **First home:** a new account gets "<First name>'s home", where they're the
  owner. Anyone can create more homes.
- **People's names:** where the others in a home see someone (who added a home's
  account, who wrote in a shared conversation, a notebook note's author, a
  template's maker), they're named by their display name, else their email's
  first part.
- **Roles:** owner (one per home, can't be changed or removed), admin and member, as `config/roles.js` names them;
  the home switcher shows each home's role.
- **Invitations off:** `workspaceInvitations` is off, so JSKIT serves none of `/api/w/<home>/invites` or
  `/api/workspace/invitations/*` (404); a home's people (`/api/w/<home>/members`) and roles stay readable to its
  people. JSKIT still asks how long an invitation would last (`workspaceMembers.defaults.inviteExpiresInMs`).
- **Configuration extension:** `config/extensions.js`, empty here, is merged last into `config/public.js`,
  objects key by key, anything else replaced. A copy built on Mercbot replaces it whole.
- **People in a home:** `homesApi.js` reads a home's whole list of people (JSKIT answers a page at a time; the page
  reads every page) for the group chats' Add person, and offers the parts a copy's own people screen builds on
  (`homeRoute`, `homeList`, `sendJsonApi`, `readJsonApi`, `attributesOf`).
- **No mail:** Mercbot sends no email of its own (a person's own copy invites and registers nobody) and keeps no
  outbox. A copy built on Mercbot that sends email brings its own
  mail delivery.
- **Live changes:** when a home's people change, everyone with a
  membership row in it (including someone just removed) gets a `home-changed`
  notice on their bot events stream, from any server. A page open in that home
  starts again if the person's own role changed or they were removed (then it
  shows the not-yours card); otherwise the home list refreshes.
- **Isolation:** every bot, file and computer route is under `/api/w/<home>/`,
  and a request for something in another home answers not found.
