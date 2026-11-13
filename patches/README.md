# Patches to installed packages

Fixes for bugs in installed packages, applied by `patch-package` from the
`postinstall` script, so they're reapplied after every `npm ci` (workspace
setup and deployment).

- `vite+8.3.5.patch`: development's bundled mode shows a "Bundling in progress" page while it
  rebuilds, which reloads only through Vite's live-update connection; through a proxy that
  connection may never arrive and the page waits forever. The patch makes that page also refresh
  itself every 3 seconds. Development only; production builds don't use it.

`patch-package` builds new patches with git, which this workspace's managed git
doesn't allow, so write the diff by hand against the published package
(`npm pack <pkg>@<version>`), then check it with `npx patch-package --reverse`
and `npx patch-package`.
