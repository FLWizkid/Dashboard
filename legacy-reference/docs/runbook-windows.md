# Runbook — running the dashboard on your Windows box

From a fresh machine to a working, private, backed-up dashboard.

Everything here runs on **your** box. Nothing in this repository provisions
anything in a cloud, and no secret in this process is ever committed — the
repository is public.

**Time:** about 45 minutes the first time, most of it waiting for images to
pull.

**Conventions:** PowerShell commands are for an ordinary (non-elevated)
prompt unless a step says otherwise. `<...>` means substitute your own value.

---

## 0. What you are building

```
your laptop / phone / headset
        │  (Tailscale, WireGuard)
        ▼
   https://dashboard.<your-tailnet>.ts.net
        │
   ┌────┴────────── the Windows box ──────────────────┐
   │  Caddy ─┬─▶ Next.js app                          │
   │         └─▶ Kong ─▶ auth / rest / realtime / storage
   │                        └─▶ Postgres ─▶ backups   │
   └──────────────────────────────────────────────────┘
```

Reachable only from your tailnet. Never from the internet.

---

## 1. Prerequisites

| Need                     | Notes                                                           |
| ------------------------ | --------------------------------------------------------------- |
| Windows 10 21H2 / 11     | Pro or Enterprise if you want BitLocker, which you do — see 2.3 |
| 16 GB RAM                | 8 GB works; the stack idles around 3 GB                         |
| 40 GB free               | Images are ~6 GB; the rest is your data and backups             |
| Administrator access     | For WSL2, Docker Desktop, BitLocker and the scheduled tasks     |
| A Tailscale account      | The free tier is enough                                         |
| A second disk or NAS     | For backup copy 2. Can be added later                           |
| Cloud storage for copy 3 | Anything `rclone` supports. Can be added later                  |

---

## 2. Prepare Windows

### 2.1 WSL2

Elevated PowerShell:

```powershell
wsl --install
wsl --set-default-version 2
wsl --update
```

Reboot when it asks. Confirm:

```powershell
wsl --status      # "Default Version: 2"
```

### 2.2 Docker Desktop

Install from <https://www.docker.com/products/docker-desktop/>, then in
**Settings**:

- **General** → _Use the WSL 2 based engine_ ✔
- **General** → _Start Docker Desktop when you log in_ ✔
- **Resources** → give it at least 4 CPUs and 8 GB if you have them
- **Resources → WSL Integration** → enable for your distro

Confirm:

```powershell
docker version
docker compose version    # v2.20 or newer
```

### 2.3 BitLocker — do not skip this

This is the encryption-at-rest control for the whole product. Postgres stores
your data unencrypted on disk; the volume underneath is what protects it if
the machine is stolen or the drive is pulled.

Encrypt the drive holding the **Docker data root** (usually `C:`):

```powershell
# Elevated
Get-BitLockerVolume                       # check current state
Enable-BitLocker -MountPoint "C:" -EncryptionMethod XtsAes256 -UsedSpaceOnly -TpmProtector
```

Save the recovery key somewhere that is **not this machine**.

If you put backups on a second internal disk, encrypt that too.

### 2.4 Node.js

Only needed to generate secrets and to run the test suite. Install Node 22
from <https://nodejs.org/>, or:

```powershell
winget install OpenJS.NodeJS.LTS
```

---

## 3. Tailscale

### 3.1 Install and join

```powershell
winget install tailscale.tailscale
tailscale up
```

### 3.2 Enable MagicDNS and HTTPS

Both are in the admin console, both are one-time:

1. <https://login.tailscale.com/admin/dns> → **MagicDNS**: enable
2. Same page → **HTTPS Certificates**: enable

Without the second, `tailscale cert` in step 6 will fail.

### 3.3 Note your hostname and address

```powershell
tailscale status        # first line: this machine's name
tailscale ip -4         # 100.x.y.z
```

Your hostname is `<machine-name>.<tailnet-name>.ts.net`, for example
`dashboard.tail1234.ts.net`. You need both values in step 5.

### 3.4 Lock the tailnet down (recommended)

In **Access controls**, restrict who can reach the box. A minimal policy that
lets only your own devices in:

```jsonc
{
  "acls": [
    { "action": "accept", "src": ["autogroup:member"], "dst": ["*:443"] },
  ],
}
```

Also turn on **device approval** so a new device cannot join silently.

---

## 4. Get the code

```powershell
cd $HOME
git clone https://github.com/FLWizkid/Dashboard.git
cd Dashboard
```

---

## 5. Generate the secrets

```powershell
node ops/generate-secrets.mjs `
  --hostname dashboard.tail1234.ts.net `
  --bind 100.x.y.z
```

This writes `.env` (mode 0600) containing the database password, the JWT
secret, and the two API keys derived from it.

Verify it can never be committed — the repository is public:

```powershell
git check-ignore -v .env        # must print a .gitignore rule
git status --porcelain          # .env must NOT appear
```

**Copy `JWT_SECRET` somewhere off this box now** — a password manager. Losing
it means reissuing every key and signing out every device.

---

## 6. Issue the TLS certificate

```powershell
pwsh ops/windows/Update-TailscaleCert.ps1
```

It writes `ops/caddy/certs/<hostname>.crt` and `.key`, which Caddy mounts
read-only. Both are git-ignored.

If it fails, the error tells you which of the three usual causes it is;
step 3.2 is the most common.

---

## 7. First boot

```powershell
docker compose build            # a few minutes the first time
docker compose up -d
docker compose ps
```

Wait for `db` to report healthy, then watch the rest settle:

```powershell
docker compose logs -f --tail 50
```

Ctrl-C stops following; it does not stop the stack.

---

## 8. Apply the migrations

The init scripts in `ops/db/init/` ran automatically on the empty database.
The product's own schema is in `supabase/migrations/` and is applied in
filename order:

```powershell
Get-ChildItem supabase/migrations/*.sql | Sort-Object Name | ForEach-Object {
    Write-Host "applying $($_.Name)"
    Get-Content $_.FullName -Raw | docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1
}
```

Every migration is idempotent, so re-running the whole directory after an
update is safe and is the normal way to upgrade the schema.

Check:

```powershell
docker compose exec db psql -U postgres -c "\dt public.*"
# tasks, activity_categories, task_links, profiles
```

---

## 9. Create your account

Signup is disabled, on purpose. Create the single account through the admin
API, using the service-role key:

```powershell
$env:DOTENV = Get-Content .env | Where-Object { $_ -match '^SERVICE_ROLE_KEY=' }
$service = ($env:DOTENV -split '=', 2)[1]
$host_   = ((Get-Content .env | Where-Object { $_ -match '^TAILNET_HOSTNAME=' }) -split '=', 2)[1]

$body = @{
    email         = 'doug@theonefor.ai'
    password      = '<a long passphrase>'
    email_confirm = $true
} | ConvertTo-Json

Invoke-RestMethod -Method Post -Uri "https://$host_/auth/v1/admin/users" `
    -Headers @{ apikey = $service; Authorization = "Bearer $service" } `
    -ContentType 'application/json' -Body $body
```

Creating the user fires the signup trigger, which seeds your profile and the
eight activity categories. Confirm:

```powershell
docker compose exec db psql -U postgres -c "select name from public.activity_categories order by position"
```

Then **clear the variables** so the service-role key does not linger in your
shell history or environment:

```powershell
Remove-Variable service, body -ErrorAction SilentlyContinue
$env:DOTENV = $null
```

---

## 10. Sign in

Open `https://dashboard.<your-tailnet>.ts.net` from any device on the
tailnet. You should get a valid certificate with no warning, the login page,
and then the dashboard.

Install it as an app: **⋮ → Install** in Chrome or Edge, **Share → Add to
Home Screen** on iOS.

---

## 11. Verify it is private

Do this once, properly. It is the check that matters most.

```powershell
# Only caddy should map a host port, and only to your tailnet address.
docker compose ps --format '{{.Service}}  {{.Ports}}'

# Nothing should be listening on 0.0.0.0:443.
netstat -an | Select-String ':443.*LISTEN'
```

Then, from a device **not** on the tailnet (phone on mobile data):

```
https://dashboard.<your-tailnet>.ts.net     → must time out, not load
```

If it loads, stop and fix `BIND_ADDRESS` before putting real data in.

---

## 12. Scheduled jobs

```powershell
# Elevated
pwsh ops/windows/Install-ScheduledTasks.ps1
```

That registers certificate renewal (daily) and bringing the stack up at logon.
Backups and the restore drill run inside the `backup` container and need no
Windows task.

```powershell
Get-ScheduledTask -TaskName "CIO Dashboard*"
```

---

## 13. Backups

Full detail in [backups.md](backups.md). The short version:

```powershell
# 1. Take one now, and confirm it restores.
docker compose exec backup backup.sh
docker compose exec backup restore-drill.sh

# 2. Point copy 2 at a different physical device, in .env:
#    BACKUP_SECONDARY_PATH=D:/dashboard-backups
#
# 3. Set up the encrypted off-site copy — an age key and an rclone remote.
docker compose up -d backup     # re-read .env after changing it
```

Until both off-site settings are present, every backup log ends with
**"NOT yet a 3-2-1 backup"**. That is intentional.

---

## Day to day

| Task                 | Command                                                          |
| -------------------- | ---------------------------------------------------------------- |
| Start                | `docker compose up -d`                                           |
| Stop                 | `docker compose stop`                                            |
| Stop and remove      | `docker compose down` (volumes are kept)                         |
| Logs                 | `docker compose logs -f app`                                     |
| What is running      | `docker compose ps`                                              |
| Admin tools          | `docker compose --profile admin up -d` → <http://127.0.0.1:3001> |
| Stop admin tools     | `docker compose --profile admin stop studio meta`                |
| Backup now           | `docker compose exec backup backup.sh`                           |
| List backups         | `docker compose exec backup restore.sh --list`                   |
| Prove a backup works | `docker compose exec backup restore-drill.sh`                    |

### Updating the application

```powershell
git pull
docker compose build app
docker compose up -d app

# then re-apply migrations (idempotent)
Get-ChildItem supabase/migrations/*.sql | Sort-Object Name | ForEach-Object {
    Get-Content $_.FullName -Raw | docker compose exec -T db psql -U postgres -v ON_ERROR_STOP=1
}
```

If `TAILNET_HOSTNAME` changed, you must **rebuild**, not just restart: the URL
is compiled into the browser bundle.

### Bumping the Supabase images

The tags in `docker-compose.yml` are pinned so an upstream re-tag can never
change your box silently. To move:

1. Take a backup, and run the drill.
2. Change one tag.
3. `docker compose up -d <service>` and read its logs.
4. Sign in, add a task, complete it.
5. Repeat for the next service. One at a time — a stack that breaks after
   five simultaneous bumps tells you nothing about which one broke it.

### Rotating secrets

Rotating `JWT_SECRET` signs out every device and invalidates both API keys,
because they are JWTs signed with it.

```powershell
docker compose exec backup backup.sh          # 1. backup first
node ops/generate-secrets.mjs --hostname <host> --bind <ip> --force
docker compose down
docker compose build app                       # the anon key is in the bundle
docker compose up -d
```

The database password is a special case: `ops/db/init/02-roles.sql` only runs
on an **empty** data directory, so after changing `POSTGRES_PASSWORD` you must
apply it by hand once:

```powershell
Get-Content ops/db/init/02-roles.sql -Raw | docker compose exec -T db psql -U postgres
docker compose restart auth rest realtime storage backup
```

---

## Troubleshooting

**`tailscale cert` fails**
HTTPS is not enabled for the tailnet (step 3.2), the hostname is not this
machine's, or Tailscale is logged out. `tailscale status` answers all three.

**The browser warns about the certificate**
Caddy is serving a stale or wrong-name certificate. Reissue:
`pwsh ops/windows/Update-TailscaleCert.ps1 -Force`.

**`caddy` restarts in a loop**
Almost always a missing certificate file. `docker compose logs caddy` names
the path it wanted.

**The site is unreachable from another device**
`BIND_ADDRESS` is still `127.0.0.1`, or is not this box's current Tailscale
address — it can change. Compare `tailscale ip -4` with the `.env` value, then
`docker compose up -d caddy`.

**Sign-in returns 500**
`docker compose logs auth`. Usually `supabase_auth_admin` cannot connect
because `POSTGRES_PASSWORD` changed without re-applying `02-roles.sql` — see
Rotating secrets.

**PostgREST returns `JWSError` or 401 for everything**
`ANON_KEY` and `JWT_SECRET` are out of step. They must come from the same
`generate-secrets.mjs` run.

**The app builds but shows no data**
The browser bundle has the wrong Supabase URL. Rebuild the app image, don't
just restart it.

**Docker Desktop won't start after a Windows update**
`wsl --update`, then restart Docker Desktop. If WSL is wedged:
`wsl --shutdown` and start it again.

**Out of disk**
`docker system df`, then `docker image prune -a` for images no longer
referenced. Never `docker volume prune` — that is your database.

---

## Monthly review

Ten minutes, first of the month. This is the detection story in
[the threat model](threat-model.md#7-detection--what-would-tell-you-something-is-wrong).

```powershell
docker compose ps --format '{{.Service}}  {{.Ports}}'   # only caddy maps a port
docker compose logs backup --since 720h | Select-String "DRILL|3-2-1"
docker compose logs auth   --since 720h | Select-String "invalid"
git status --porcelain                                   # .env untracked, never tracked
```

Plus: the Tailscale device list, and confirm your off-site backup provider
still has recent objects.

---

## Related

[Threat model](threat-model.md) · [Backups](backups.md) ·
[Data model](data-model.md) · [Testing](testing.md) · [PLAN.md](../PLAN.md)
