<#
.SYNOPSIS
    Issues or renews the TLS certificate Caddy serves, using Tailscale.

.DESCRIPTION
    `tailscale cert` obtains a real Let's Encrypt certificate for this node's
    *.ts.net name through Tailscale's DNS. That matters here: the box is not
    publicly reachable, so Caddy cannot run ACME itself, and yet every device
    on the tailnet trusts the result with no CA to install.

    Safe to run on a schedule. It does nothing unless the certificate is
    inside its renewal window, so a daily task is cheap.

    Prerequisite: HTTPS must be enabled for the tailnet, once, at
    https://login.tailscale.com/admin/dns  →  "Enable HTTPS".

.PARAMETER Hostname
    The tailnet hostname, e.g. dashboard.tail1234.ts.net. Defaults to
    TAILNET_HOSTNAME from the .env beside the compose file.

.PARAMETER RenewWithinDays
    Renew when fewer than this many days remain. Default 30.

.PARAMETER Force
    Reissue even if the current certificate is still comfortable.

.PARAMETER SkipReload
    Don't ask the running Caddy container to reload.

.EXAMPLE
    pwsh ops/windows/Update-TailscaleCert.ps1

.EXAMPLE
    pwsh ops/windows/Update-TailscaleCert.ps1 -Hostname dashboard.tail1234.ts.net -Force
#>

[CmdletBinding()]
param(
    [string] $Hostname,
    [int]    $RenewWithinDays = 30,
    [switch] $Force,
    [switch] $SkipReload
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
$CertDir  = Join-Path $RepoRoot 'ops\caddy\certs'
$EnvFile  = Join-Path $RepoRoot '.env'

function Get-EnvValue {
    param([string] $Name)

    if (-not (Test-Path -LiteralPath $EnvFile)) { return $null }

    foreach ($line in Get-Content -LiteralPath $EnvFile) {
        if ($line -match "^\s*$([regex]::Escape($Name))\s*=\s*(.*?)\s*$") {
            return $Matches[1].Trim('"').Trim("'")
        }
    }
    return $null
}

function Resolve-Tailscale {
    $command = Get-Command tailscale -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }

    # Default install location; the CLI is not on PATH in every setup.
    $fallback = Join-Path $env:ProgramFiles 'Tailscale\tailscale.exe'
    if (Test-Path -LiteralPath $fallback) { return $fallback }

    throw 'tailscale.exe not found. Install Tailscale, or add it to PATH.'
}

# ── Work out what we are issuing for ──────────────────────────────────────
if (-not $Hostname) { $Hostname = Get-EnvValue 'TAILNET_HOSTNAME' }

if (-not $Hostname) {
    throw "No hostname. Pass -Hostname, or set TAILNET_HOSTNAME in $EnvFile."
}

if ($Hostname -notmatch '^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$') {
    throw "'$Hostname' does not look like a hostname."
}

$Tailscale = Resolve-Tailscale
$CertPath  = Join-Path $CertDir "$Hostname.crt"
$KeyPath   = Join-Path $CertDir "$Hostname.key"

New-Item -ItemType Directory -Force -Path $CertDir | Out-Null

# ── Is a renewal actually due? ────────────────────────────────────────────
if (-not $Force -and (Test-Path -LiteralPath $CertPath)) {
    try {
        $existing = New-Object System.Security.Cryptography.X509Certificates.X509Certificate2 -ArgumentList $CertPath
        $daysLeft = [math]::Floor(($existing.NotAfter - (Get-Date)).TotalDays)

        if ($daysLeft -gt $RenewWithinDays) {
            Write-Host "Certificate for $Hostname is valid for $daysLeft more days. Nothing to do."
            return
        }

        Write-Host "Certificate expires in $daysLeft days — renewing."
    }
    catch {
        Write-Warning "Could not read $CertPath ($($_.Exception.Message)); reissuing."
    }
}

# ── Issue ─────────────────────────────────────────────────────────────────
# Write to temporary files first. A half-written certificate that Caddy picks
# up on reload is a worse outcome than a slightly stale one.
$tempCert = "$CertPath.new"
$tempKey  = "$KeyPath.new"

Write-Host "Requesting a certificate for $Hostname ..."
& $Tailscale cert --cert-file $tempCert --key-file $tempKey $Hostname

if ($LASTEXITCODE -ne 0) {
    Remove-Item -LiteralPath $tempCert, $tempKey -ErrorAction SilentlyContinue
    throw @"
tailscale cert failed (exit $LASTEXITCODE).

The usual causes, in order:
  1. HTTPS is not enabled for the tailnet.
     https://login.tailscale.com/admin/dns -> Enable HTTPS
  2. '$Hostname' is not this machine's name in the tailnet.
     Check with: tailscale status
  3. Tailscale is not logged in: tailscale status
"@
}

if (-not (Test-Path -LiteralPath $tempCert) -or -not (Test-Path -LiteralPath $tempKey)) {
    throw 'tailscale cert reported success but produced no files.'
}

Move-Item -LiteralPath $tempCert -Destination $CertPath -Force
Move-Item -LiteralPath $tempKey  -Destination $KeyPath  -Force

# The private key is for this account only.
foreach ($path in @($KeyPath, $CertPath)) {
    $acl = Get-Acl -LiteralPath $path
    $acl.SetAccessRuleProtection($true, $false)
    $acl.Access | ForEach-Object { $acl.RemoveAccessRule($_) | Out-Null }
    $acl.AddAccessRule((New-Object System.Security.AccessControl.FileSystemAccessRule(
        [System.Security.Principal.WindowsIdentity]::GetCurrent().Name,
        'FullControl', 'Allow')))
    Set-Acl -LiteralPath $path -AclObject $acl
}

Write-Host "Wrote $CertPath"

# ── Tell Caddy ────────────────────────────────────────────────────────────
if ($SkipReload) { return }

$running = & docker compose --project-directory $RepoRoot ps --status running --services 2>$null

if ($LASTEXITCODE -eq 0 -and $running -contains 'caddy') {
    Write-Host 'Reloading Caddy ...'
    # The cert files are mounted, so a container restart is enough and avoids
    # depending on the admin API, which is switched off in the Caddyfile.
    & docker compose --project-directory $RepoRoot restart caddy
}
else {
    Write-Host 'Caddy is not running; it will pick the certificate up on start.'
}
