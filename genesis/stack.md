# Stack

## Stack packages
- `genesis-stack`

## Components
- `nodejs`
- `jskit`
- `postgresql`
- `jskit-postgresql`

## Resources

```json genesis-resource
{
  "id": "database",
  "kind": "postgresql",
  "environmentAlternatives": [
    {
      "bindings": {
        "database": "DB_NAME",
        "host": "DB_HOST",
        "password": "DB_PASSWORD",
        "port": "DB_PORT",
        "username": "DB_USER"
      },
      "allowEmpty": [
        "password"
      ],
      "preferred": true
    },
    {
      "bindings": {
        "url": "DATABASE_URL"
      }
    }
  ],
  "optionalBindings": {
    "testDatabase": "TEST_DB_NAME"
  }
}
```

## Environment defaults

- Default `DB_CLIENT`: `pg`

## Environment files

- Dotenv `.env`

## Verification

- Verify `application`: `npm` `run` `verify`

## Connected development

- Default package type: `npm`

## Deployment

- Runtimes: `nodejs`
- Recreate on restore: `node_modules` `.tools`
- Generated secrets: `AUTH_LOCAL_SESSION_SECRET` `MERCBOT_VAULT_KEY`
- Setup code: `AUTH_LOCAL_SETUP_CODE`
- Sandbox allows: `gvisor` `fuse`
- Ready when: `GET` `/api/health` returns `200`
- Prepare `Install dependencies and tools`: `npm` `run` `deploy:prepare`
- Build `Build`: `npm` `run` `build`
- Migrate `Migrate database`: `npm` `run` `db:migrate`
- Serve `Start`: `bash` `scripts/serve.sh`

## Outputs

### Target `app`: Run app

- Default.
- Mode: `interactive`
- Runtimes: `nodejs`
- Run `Develop`: `npm` `run` `develop`

#### Presentation

- Kind: `web`
- Preferred port: `3001`
- URL path: `/`
- Ready when: `GET` `/api/health` returns `200`

#### Preview identity

- Command: `tools/preview-identity`
- Protocol: `vibe64.preview-identity.command.v1`
- Identity types: `email`
- Runtimes: `nodejs`

### Target `test-app`: Test Preview

- Mode: `interactive`
- Data: `test`
- Runtimes: `nodejs`
- Run `Start on the test database`: `node` `tests/support/start-test-app.mjs` `{host}` `{port}`

#### Presentation

- Kind: `web`
- URL path: `/`
- Ready when: `GET` `/api/health` returns `200`

#### Preview identity

- Command: `tools/preview-identity` `.data-test`
- Protocol: `vibe64.preview-identity.command.v1`
- Identity types: `email`
- Runtimes: `nodejs`

## Resource estimates

### Output `app`

- Startup typical MiB: `1024`
- Startup high MiB: `1536`
- Running typical MiB: `768`
- Running high MiB: `1536`

### Output `test-app`

- Startup typical MiB: `1024`
- Startup high MiB: `1536`
- Running typical MiB: `768`
- Running high MiB: `1536`

### Workspace setup

- Typical MiB: `1024`
- High MiB: `1536`

## UI discovery

### Discovery `home-pages`: Home pages

- Adapter: `jskit`
- Surface: `home`
- Mode: `filesystem`
- Page root: `src/pages/w/[workspaceSlug]`
- Registration: `vite.config.mjs`
- Component root: `src/components`
- Component root: `packages`

### Discovery `auth-pages`: Auth pages

- Adapter: `jskit`
- Surface: `auth`
- Mode: `filesystem`
- Page root: `src/pages/auth`
- Registration: `vite.config.mjs`
- Component root: `src/components`
- Component root: `packages`

### Discovery `account-pages`: Account pages

- Adapter: `jskit`
- Surface: `account`
- Mode: `filesystem`
- Page root: `src/pages/account`
- Registration: `vite.config.mjs`
- Component root: `src/components`
- Component root: `packages`

## Workspace setup

- Prepare `Install dependencies` with `nodejs` when `package.json` exists: `npm` `ci`
- Prepare `Prepare database` with `nodejs` when `package.json` exists: `npm` `run` `db:prepare`
