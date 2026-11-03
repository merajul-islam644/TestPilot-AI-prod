# blocks/mail

Mail: mail server configs and templates.

**Read-only snapshot.** `blocks pull` writes these files from the project's live setup.
Editing them changes nothing on the server; use the commands below, then run
`blocks pull --only mail` to refresh. Each file's `_meta` block records the
tenant and time it was pulled, so check it before trusting a file. Secret fields are
redacted to `***` unless `--include-secrets` was passed.

| File | Change with |
|------|-------------|
| `configs.json` | `blocks mail config save/delete` |
| `templates.json` | `blocks mail template save/clone/delete` |
