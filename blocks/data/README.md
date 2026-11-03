# blocks/data

Data Gateway schemas and access rules. Two-way: edit locally, then push.

- `schemas/` -- `blocks data schema pull` writes it; `blocks data schema push` sends it back.
- `rules.json` -- `blocks data rules pull` writes it; `blocks data rules deploy` sends it back.
- `blocks data validate` checks both; `blocks data sync` pushes both.
