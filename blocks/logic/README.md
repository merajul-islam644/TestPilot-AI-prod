# blocks/logic

Logic: proxies, schedules and functions.

**Read-only snapshot.** `blocks pull` writes these files from the project's live setup.
Editing them changes nothing on the server; use the commands below, then run
`blocks pull --only logic` to refresh. Each file's `_meta` block records the
tenant and time it was pulled, so check it before trusting a file. Secret fields are
redacted to `***` unless `--include-secrets` was passed.

| File | Change with |
|------|-------------|
| `proxies.json` | `blocks logic proxy create/update/delete` |
| `schedules.json` | `blocks logic scheduler create/update/delete` |
| `functions.json` | `blocks logic function create/save/deploy/delete` |
