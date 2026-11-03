# blocks/auth

Auth: login config, OIDC clients and identity providers.

**Read-only snapshot.** `blocks pull` writes these files from the project's live setup.
Editing them changes nothing on the server; use the commands below, then run
`blocks pull --only auth` to refresh. Each file's `_meta` block records the
tenant and time it was pulled, so check it before trusting a file. Secret fields are
redacted to `***` unless `--include-secrets` was passed.

| File | Change with |
|------|-------------|
| `config.json` | `blocks auth config save` |
| `oidc-clients.json` | `blocks auth oidc-clients save/delete/rotate-secret` |
| `identity-providers.json` | `blocks auth idp create/update/delete` |
