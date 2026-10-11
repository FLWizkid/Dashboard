# Not your vault

This folder exists so `docker-compose.yml` stays valid when
`DASHBOARD_VAULT_PATH` is unset — Compose needs _something_ to bind, and a
missing host path would fail the whole stack rather than the one feature.

The app ignores it: with `DASHBOARD_VAULT_PATH` empty, `/api/vault/sync`
answers `configured: false` and never touches the disk.

To turn the vault on, point `DASHBOARD_VAULT_PATH` at the folder you open in
Obsidian. See [`docs/vault.md`](../../docs/vault.md).
