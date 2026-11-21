# Pairs this computer's agent and prints the command to start it.
#
# Usage (from the repository root):
#   powershell -ExecutionPolicy Bypass -File .\scripts\agent-setup.ps1
#
# It exists because pairing by hand needs a login, a pairing code and the agent package in the same
# step, and a mistake at any of them leaves the dashboard showing sample data with every device
# stuck in PENDING.

param(
    [string]$ApiUrl = 'http://localhost:4000',
    [string]$DeviceName = $env:COMPUTERNAME,
    [switch]$KeepCredential
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
    # ---- 1. API reachable? ----------------------------------------------------------------
    try {
        Invoke-RestMethod -Uri "$ApiUrl/api/v1/health" -TimeoutSec 10 | Out-Null
        Write-Host 'API is up.' -ForegroundColor Green
    }
    catch {
        throw "Cannot reach the API at $ApiUrl. Start it with: npm run dev"
    }

    # ---- 2. Demo password --------------------------------------------------------------
    $line = Get-Content (Join-Path $repoRoot '.env') | Where-Object { $_ -match '^SEED_DEMO_PASSWORD=' } | Select-Object -First 1
    if (-not $line) { throw 'SEED_DEMO_PASSWORD is not set in .env' }
    $password = ($line -replace '^SEED_DEMO_PASSWORD=', '').Trim()

    # ---- 3. Sign in ---------------------------------------------------------------------
    $body = @{ email = 'demo@updatepilot.local'; password = $password } | ConvertTo-Json
    $login = Invoke-RestMethod -Method Post -Uri "$ApiUrl/api/v1/auth/login" `
        -ContentType 'application/json' -Body $body -SessionVariable webSession
    Write-Host "Signed in as $($login.user.email)" -ForegroundColor Green

    # ---- 4. Clear the old credential so pairing really re-creates it ---------------------
    if (-not $KeepCredential) {
        $credentialPath = Join-Path $env:LOCALAPPDATA 'UpdatePilot\agent-credential.bin'
        if (Test-Path $credentialPath) {
            Remove-Item $credentialPath -Force
            Write-Host 'Removed the previous agent credential.' -ForegroundColor Yellow
        }
    }

    # ---- 5. Pairing code ----------------------------------------------------------------
    $code = Invoke-RestMethod -Method Post -Uri "$ApiUrl/api/v1/devices/pairing-codes" `
        -WebSession $webSession -Headers @{ 'X-CSRF-Token' = $login.csrfToken }
    Write-Host "Pairing code: $($code.code)  (expires $($code.expiresAt))" -ForegroundColor Cyan

    # ---- 6. Pair the agent --------------------------------------------------------------
    Write-Host "`nPairing as '$DeviceName'..." -ForegroundColor Cyan
    npm run pair -w apps/agent -- --code $($code.code) --name $DeviceName
    if ($LASTEXITCODE -ne 0) { throw 'Pairing failed. Read the output above.' }

    # ---- 7. Confirm the device now exists -----------------------------------------------
    # Courtesy report only: pairing has already succeeded, so a failure here must not look
    # like a failed setup.
    try {
        $devices = Invoke-RestMethod -Uri "$ApiUrl/api/v1/devices" -WebSession $webSession
        $mine = $devices.data |
            Where-Object { $_.name -eq $DeviceName -and $_.status -ne 'REVOKED' } |
            Sort-Object { if ($_.lastSeenAt) { [datetime]$_.lastSeenAt } else { [datetime]::MinValue } } -Descending |
            Select-Object -First 1

        if ($mine) {
            Write-Host "`nDevice: $($mine.name) ($($mine.id)) - status $($mine.status)" -ForegroundColor Green
            if ($mine.status -eq 'PENDING') {
                Write-Host 'It becomes ACTIVE on the agent''s first poll, which happens once you start it below.' -ForegroundColor Yellow
            }
        }
        else {
            Write-Host "`nPaired, but the device was not listed yet. Refresh the dashboard in a moment." -ForegroundColor Yellow
        }
    }
    catch {
        Write-Host "`nPaired successfully. (Could not read the device list: $($_.Exception.Message))" -ForegroundColor Yellow
    }

    Write-Host "`nNext step: start the agent and leave it running:" -ForegroundColor Cyan
    Write-Host "  npm start -w apps/agent" -ForegroundColor White
    Write-Host "`nThen either press 'Scan now' on the Overview page, or run:" -ForegroundColor Cyan
    Write-Host "  powershell -ExecutionPolicy Bypass -File .\scripts\scan.ps1" -ForegroundColor White
}
finally {
    Pop-Location
}
