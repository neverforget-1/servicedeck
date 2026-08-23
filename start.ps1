<#
.SYNOPSIS
    Start the ServiceDeck dashboard and open it in your browser.

.DESCRIPTION
    Idempotent: if a healthy dashboard is already listening, it just opens
    the page. Locates Node.js from PATH or standard install locations.
#>
[CmdletBinding()]
param(
    [switch]$NoOpen
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$Port = 8777
if (Test-Path (Join-Path $Root 'services.json')) {
    try {
        $manifest = Get-Content (Join-Path $Root 'services.json') -Raw | ConvertFrom-Json
        if ($manifest.dashboard.port) { $Port = [int]$manifest.dashboard.port }
    } catch { }
}
$Url = "http://127.0.0.1:$Port/"
$LogRoot = Join-Path $Root 'logs'
New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

function Test-Dashboard {
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/api/health" -TimeoutSec 2
        return $response.StatusCode -eq 200
    }
    catch { return $false }
}

function Resolve-Node {
    $command = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in @(
        "$env:ProgramFiles\nodejs\node.exe",
        "${env:ProgramFiles(x86)}\nodejs\node.exe",
        "$env:LOCALAPPDATA\Programs\nodejs\node.exe"
    )) {
        if (Test-Path -LiteralPath $candidate) { return $candidate }
    }
    throw "Node.js was not found. Install Node 18+ from https://nodejs.org or add it to PATH."
}

$listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue | Select-Object -First 1
if ($listener) {
    if (-not (Test-Dashboard)) {
        throw "Port $Port is occupied by another program; the dashboard was not started."
    }
}
else {
    $node = Resolve-Node
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $stdout = Join-Path $LogRoot "dashboard-$stamp.stdout.log"
    $stderr = Join-Path $LogRoot "dashboard-$stamp.stderr.log"
    Start-Process -FilePath $node -ArgumentList @('server.js') `
        -WorkingDirectory $Root -WindowStyle Hidden `
        -RedirectStandardOutput $stdout -RedirectStandardError $stderr | Out-Null
    $deadline = (Get-Date).AddSeconds(20)
    while ((Get-Date) -lt $deadline) {
        if (Test-Dashboard) { break }
        Start-Sleep -Milliseconds 400
    }
    if (-not (Test-Dashboard)) {
        throw "The dashboard did not become healthy within 20 seconds. See logs\dashboard-$stamp.stderr.log"
    }
}

if (-not $NoOpen) {
    Start-Process $Url | Out-Null
}
