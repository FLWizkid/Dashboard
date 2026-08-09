# ops — everything that makes this run on the box

The application is in `src/`. This directory is how it becomes a running,
private, backed-up system on a Windows machine.

```
ops/
├── generate-secrets.mjs   Writes .env: passwords, JWT secret, both API keys
├── lib/                   The generator's testable core (+ its unit tests)
├── caddy/Caddyfile        TLS termination and routing — the only listener
├── caddy/certs/           Tailscale-issued certificate (git-ignored)
├── kong/                  Declarative gateway config for the Supabase APIs
├── db/init/               One-time database bootstrap (roles, JWT, extensions)
├── backup/                Backup, restore and the weekly restore drill
├── backups/               Backup copy 1 (git-ignored)
├── backups-secondary/     Mount point for copy 2, on another device
└── windows/               Host-side PowerShell: certificates, scheduled tasks
```

Start with [docs/runbook-windows.md](../docs/runbook-windows.md). It goes from
a fresh machine to a working dashboard in order.

## The two things worth knowing before you change anything here

**1. Nothing may be published beyond the tailnet.** Every host port in
`docker-compose.yml` binds to `${BIND_ADDRESS}`, which defaults to
`127.0.0.1`. A missing value makes the stack unreachable rather than public.
Unit tests in `lib/compose.test.mts` assert this, and CI re-checks it against
the _resolved_ compose config. Docker publishes ports by bypassing the Windows
Firewall, so the bind address is the control, not the firewall.

**2. No secret may enter the repository.** It is public. `.env`, certificates,
the rclone config and every backup artefact are git-ignored, and CI fails if
one is ever tracked.

## Testing what is here

```bash
npm run test                       # includes ops/lib unit tests
docker compose --env-file .env config --quiet
docker compose exec backup restore-drill.sh    # on the box
```

The CI workflow's **Deployment configuration** job runs the equivalent checks
on every push: compose resolves, the Caddyfile is valid, the shell and
PowerShell scripts parse, and nothing secret is tracked.

## Related

[Runbook](../docs/runbook-windows.md) · [Backups](../docs/backups.md) ·
[Threat model](../docs/threat-model.md)
