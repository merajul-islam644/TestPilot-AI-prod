# blocks/iam

IAM: roles, permissions, resource groups and features.

**Read-only snapshot.** `blocks pull` writes these files from the project's live setup.
Editing them changes nothing on the server; use the commands below, then run
`blocks pull --only iam` to refresh. Each file's `_meta` block records the
tenant and time it was pulled, so check it before trusting a file. Secret fields are
redacted to `***` unless `--include-secrets` was passed.

| File | Change with |
|------|-------------|
| `roles.json` | `blocks iam roles create/update/assign-permissions` |
| `permissions.json` | `blocks iam permissions create/update` |
| `resource-groups.json` | `no CLI command (read-only)` |
| `features.json` | `no CLI command (read-only)` |
