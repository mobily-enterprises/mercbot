# Email and password accounts

This boundary lets a person create and access a private account without using
an external identity provider.

## Sources

- `package.json`
- Main: `config/public.js`
- `server/lib/runtimeEnv.js`

## Public contract

Mercbot has no sign-in, registration, password reset or sign-out pages. It signs
its one person in by the copy's key (D-81,
`genesis/program/single-user/single-user.md`), and its sign-in, registration,
sign-out and password routes answer 404. Since nobody registers, its production
asks for no email confirmation unless `AUTH_LOCAL_EMAIL_CONFIRMATION` is set
(`resolveRuntimeEnv`), so it starts without the confirmation sender Mercbot
doesn't have.

A copy built on Mercbot that serves many people starts without the single-user
gate (`gate: false`, `genesis/program/operations/runtime.md`) and keeps JSKIT's
local accounts: its routes (`/api/register`, `/api/login`, `/api/logout`,
`/api/session`) answer as JSKIT describes, and a new account waits until its
email is confirmed unless `AUTH_LOCAL_EMAIL_CONFIRMATION=false`, which the
database tests that register accounts set (README, Check changes); the copy's
own confirmation sender sends the links, and without one development logs
them. In production no confirmation is asked unless `AUTH_LOCAL_EMAIL_CONFIRMATION`
is set (`resolveRuntimeEnv`), so such a copy sets it where it sends the links.
Private surfaces send a visitor who isn't signed in to `/auth/login`, keeping
the intended return destination. Mercbot doesn't serve that page itself: such a
copy adds its sign-in, registration, password and sign-out pages, and the
account menu's and Settings → General's entries for them
(`src/components/mercbot/extensions.js`).
