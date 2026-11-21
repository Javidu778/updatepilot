# Queues a scan for the paired UpdatePilot agent and watches it finish.
#
# Usage (from the repository root):
#   powershell -ExecutionPolicy Bypass -File .\scripts\scan.ps1
#
# Why this exists: every manual attempt needed a login, a device id and a CSRF token in the same
# PowerShell session, and losing one of them produced confusing NullReferenceException errors.
# This script does the whole flow in one process and prints what it is doing at each step.

param(
    [string]$ApiUrl = 'http://localhost:4000',
    [int]$TimeoutSeconds = 180
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    # ---- 1. Read the demo password from .env -----------------------------------------------
    $envFile = Join-Path $repoRoot '.env'
    if (-not (Test-Path $envFile)) { throw ".env not found at $envFile. Copy .env.example to .env first." }

    $line = Get-Content $envFile | Where-Object { $_ -match '^SEED_DEMO_PASSWORD=' } | Select-Object -First 1
    if (-not $line) { throw 'SEED_DEMO_PASSWORD is not set in .env' }
    $password = ($line -replace '^SEED_DEMO_PASSWORD=', '').Trim()
    if (-not $password) { throw 'SEED_DEMO_PASSWORD is empty in .env' }

    # ---- 2. Is the API up? ----------------------------------------------------------------
    try {
        $health = Invoke-RestMethod -Uri "$ApiUrl/api/v1/health" -TimeoutSec 10
        Write-Host "API is up (status: $($health.status))" -ForegroundColor Green
    }
    catch {
        throw "Cannot reach the API at $ApiUrl. Start it with: npm run dev"
    }

    # ---- 3. Sign in -----------------------------------------------------------------------
    $body = @{ email = 'demo@updatepilot.local'; password = $password } | ConvertTo-Json
    $login = Invoke-RestMethod -Method Post -Uri "$ApiUrl/api/v1/auth/login" `
        -ContentType 'application/json' -Body $body -SessionVariable webSession
    Write-Host "Signed in as $($login.user.email)" -ForegroundColor Green

    # ---- 4. Pick the paired device --------------------------------------------------------
    $devices = Invoke-RestMethod -Uri "$ApiUrl/api/v1/devices" -WebSession $webSession
    if (-not $devices.data -or $devices.data.Count -eq 0) {
        throw 'No devices yet. Pair the agent first: npm run pair -w apps/agent -- --code XXXX-XXXX'
    }

    Write-Host "`nDevices:" -ForegroundColor Cyan
    $devices.data | Format-Table name, status, connection, lastSeenAt -AutoSize | Out-String | Write-Host

    $device = $devices.data |
        Where-Object { $_.status -ne 'REVOKED' } |
        Sort-Object { if ($_.lastSeenAt) { [datetime]$_.lastSeenAt } else { [datetime]::MinValue } } -Descending |
        Select-Object -First 1

    if (-not $device) {
        throw 'No device has contacted the API yet. Start the agent: npm start -w apps/agent'
    }
    Write-Host "Using device: $($device.name) ($($device.id)) - last seen $($device.lastSeenAt)" -ForegroundColor Green

    # ---- 5. Queue the scan ----------------------------------------------------------------
    $headers = @{
        'X-CSRF-Token'    = $login.csrfToken
        'Idempotency-Key' = [guid]::NewGuid().ToString()
    }

    try {
        $scan = Invoke-RestMethod -Method Post -Uri "$ApiUrl/api/v1/devices/$($device.id)/scans" `
            -WebSession $webSession -Headers $headers
    }
    catch {
        $detail = $_.ErrorDetails.Message
        if ($detail -match 'INVALID_STATE') {
            Write-Host "`nA scan is already queued or running for this device." -ForegroundColor Yellow
            Write-Host 'Wait for it to finish (about 10 seconds), then run this script again.' -ForegroundColor Yellow
            exit 0
        }
        throw
    }

    Write-Host "Scan queued: $($scan.id) (state: $($scan.state))" -ForegroundColor Green

    # ---- 6. Watch it finish ---------------------------------------------------------------
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastState = $null

    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Seconds 2
        $current = Invoke-RestMethod -Uri "$ApiUrl/api/v1/scans/$($scan.id)" -WebSession $webSession

        if ($current.state -ne $lastState) {
            Write-Host ("  {0:HH:mm:ss}  {1}" -f (Get-Date), $current.state)
            $lastState = $current.state
        }

        if ($current.state -in @('SUCCEEDED', 'FAILED', 'INTERRUPTED', 'CANCELLED')) {
            Write-Host ''
            if ($current.state -eq 'SUCCEEDED') {
                Write-Host "Scan finished successfully." -ForegroundColor Green
                Write-Host "Open http://localhost:3000/applications to see the inventory." -ForegroundColor Cyan
            }
            else {
                Write-Host "Scan ended as $($current.state)." -ForegroundColor Yellow
                if ($current.errorSummary) { Write-Host "Reason: $($current.errorSummary)" }
                Write-Host 'Check that the agent is running: npm start -w apps/agent'
            }
            exit 0
        }
    }

    Write-Host "`nStill $lastState after $TimeoutSeconds seconds." -ForegroundColor Yellow
    Write-Host 'The agent has probably not claimed the job. Check the agent window for errors.' -ForegroundColor Yellow
}
finally {
    Pop-Location
}
