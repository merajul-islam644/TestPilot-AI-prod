# blocks/release

Release: repos registered for deployment.

**Read-only snapshot.** `blocks pull` writes these files from the project's live setup.
Editing them changes nothing on the server; use the commands below, then run
`blocks pull --only release` to refresh. Each file's `_meta` block records the
tenant and time it was pulled, so check it before trusting a file. Secret fields are
redacted to `***` unless `--include-secrets` was passed.

| File | Change with |
|------|-------------|
| `repos.json` | `blocks release setup/deploy/teardown` |
