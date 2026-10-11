<#
.SYNOPSIS
    Registers the recurring jobs that have to run on the Windows host.

.DESCRIPTION
    Almost everything recurring lives inside the stack — backups run in the
    backup container on its own schedule. Two things cannot, because they
    need the host:

      * Certificate renewal, which needs the Tailscale client.
      * Starting the stack at boot, so a reboot doesn't quietly take the
        dashboard away until you notice.

    Idempotent: re-running replaces the tasks rather than duplicating them.

.PARAMETER CertRenewalTime
    Daily time for the certificate check. Default 03:30.

.PARAMETER Remove
    Unregister the tasks instead of installing them.

.EXAMPLE
    pwsh ops/windows/Install-ScheduledTasks.ps1
#>

[CmdletBinding()]
param(
    [string] $CertRenewalTime = '03:30',
    [switch] $Remove
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)

$Tasks = @{
    'CIO Dashboard - Renew TLS certificate' = 'cert'
    'CIO Dashboard - Start stack at boot'   = 'boot'
}

if ($Remove) {
    foreach ($name in $Tasks.Keys) {
        if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "Removed: $name"
        }
    }
    return
}

# Scheduled tasks that touch Docker and Tailscale need administrator rights.
$identity  = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run this in an elevated PowerShell (Run as administrator).'
}

# Written the long way rather than with `?.` so this file also parses under
# Windows PowerShell 5.1, which is still what a bare `powershell` gives you.
$pwshCommand = Get-Command pwsh -ErrorAction SilentlyContinue
if ($pwshCommand) {
    $pwsh = $pwshCommand.Source
}
else {
    $pwsh = (Get-Command powershell).Source
}

$runAs = New-ScheduledTaskPrincipal -UserId $identity.Name -LogonType S4U -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -ExecutionTimeLimit (New-TimeSpan -Hours 1)

# ── Certificate renewal ───────────────────────────────────────────────────
$certScript = Join-Path $RepoRoot 'ops\windows\Update-TailscaleCert.ps1'
$certAction = New-ScheduledTaskAction -Execute $pwsh `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -File `"$certScript`"" `
    -WorkingDirectory $RepoRoot

Register-ScheduledTask `
    -TaskName 'CIO Dashboard - Renew TLS certificate' `
    -Description 'Renews the Tailscale-issued certificate when it is inside 30 days of expiry, and restarts Caddy if it changed.' `
    -Action $certAction `
    -Trigger (New-ScheduledTaskTrigger -Daily -At $CertRenewalTime) `
    -Principal $runAs `
    -Settings $settings `
    -Force | Out-Null

Write-Host "Installed: certificate renewal, daily at $CertRenewalTime"

# ── Start at boot ─────────────────────────────────────────────────────────
# Docker Desktop needs a moment after logon before it will accept commands,
# hence the delay and the retry loop.
$bootCommand = @"
`$deadline = (Get-Date).AddMinutes(10)
while ((Get-Date) -lt `$deadline) {
    docker info *> `$null
    if (`$LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 15
}
docker compose --project-directory '$RepoRoot' up -d
"@

$bootAction = New-ScheduledTaskAction -Execute $pwsh `
    -Argument "-NoProfile -NonInteractive -ExecutionPolicy Bypass -Command `"$($bootCommand -replace '"', '\"')`"" `
    -WorkingDirectory $RepoRoot

Register-ScheduledTask `
    -TaskName 'CIO Dashboard - Start stack at boot' `
    -Description 'Brings the stack up once Docker Desktop is ready after a restart.' `
    -Action $bootAction `
    -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $identity.Name) `
    -Principal $runAs `
    -Settings $settings `
    -Force | Out-Null

Write-Host 'Installed: start stack at logon'
Write-Host ''
Write-Host 'Check them with:  Get-ScheduledTask -TaskName "CIO Dashboard*"'
Write-Host 'Run one now with: Start-ScheduledTask -TaskName "CIO Dashboard - Renew TLS certificate"'
