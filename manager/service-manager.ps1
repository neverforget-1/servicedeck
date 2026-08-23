<#
.SYNOPSIS
    ServiceDeck generic lifecycle engine (Windows / PowerShell 5.1+).

.DESCRIPTION
    This script contains NO knowledge of any concrete service. Everything it
    does is driven by the declarative registry (services.json): each entry
    declares a kind (process | docker-compose | ssh-tunnel | external), how to
    start it, how to probe its health, how to identify the exact processes
    that belong to it, and which capabilities (start/stop/logs) are exposed.

    The HTTP layer (server.js) only ever invokes this script with an action id
    that it first validated against the same registry, so the action surface is
    whitelisted twice — once in Node, once here.

.PARAMETER Action
    One of: status-json | start-common | stop-common | start-<service-id> | stop-<service-id>.

.PARAMETER ManifestPath
    Optional override for the registry file. Defaults to services.json next to
    the project root.
#>
[CmdletBinding()]
param(
    [ValidatePattern('^(status-json|probe-report|start-common|stop-common|(start|stop)-[a-z0-9][a-z0-9-]{0,63})$')]
    [string]$Action = 'status-json',

    [string]$ManifestPath,

    [switch]$NoPauseOnError
)

$ErrorActionPreference = 'Stop'

# The dashboard spawns this script with a fully literal argument list and
# passes the requested action through DECK_ACTION instead. Re-validate it
# with the same rules as the -Action parameter before use.
if ($env:DECK_ACTION -and -not $PSBoundParameters.ContainsKey('Action')) {
    $envAction = [string]$env:DECK_ACTION
    if ($envAction -notmatch '^(status-json|probe-report|start-common|stop-common|(start|stop)-[a-z0-9][a-z0-9-]{0,63})$') {
        throw "Invalid DECK_ACTION value."
    }
    $Action = $envAction
}

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$DeckRoot = Split-Path -Parent $ScriptRoot
$LogRoot = Join-Path $DeckRoot 'logs'
if (-not $ManifestPath) { $ManifestPath = Join-Path $DeckRoot 'services.json' }

if (-not (Test-Path -LiteralPath $ManifestPath)) {
    throw "Service registry not found at $ManifestPath. Copy services.example.json to services.json first."
}

$Manifest = Get-Content -LiteralPath $ManifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Global:DeckTitle = if ($Manifest.dashboard.title) { [string]$Manifest.dashboard.title } else { 'ServiceDeck' }

# "status-json" and "probe-report" output must be pure JSON on stdout;
# suppress human chatter.
$Script:MachineMode = ($Action -in @('status-json', 'probe-report'))

New-Item -ItemType Directory -Force -Path $LogRoot | Out-Null

# ---------------------------------------------------------------- utilities

function Write-Log {
    param([string]$Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath (Join-Path $LogRoot 'manager.log') -Value $line -Encoding UTF8
}

function Write-Info {
    param([string]$Message)
    if (-not $Script:MachineMode) { Write-Host "[info] $Message" -ForegroundColor Cyan }
    Write-Log $Message
}

function Write-Ok {
    param([string]$Message)
    if (-not $Script:MachineMode) { Write-Host "[ ok ] $Message" -ForegroundColor Green }
    Write-Log $Message
}

function Write-WarnLine {
    param([string]$Message)
    if (-not $Script:MachineMode) { Write-Host "[warn] $Message" -ForegroundColor Yellow }
    Write-Log "WARN: $Message"
}

# Expand ${SD_HOME} and any ${ENVIRONMENT_VARIABLE} inside a registry string.
function Expand-DeckPath {
    param([string]$Value)
    if (-not $Value) { return $Value }
    $expanded = $Value.Replace('${SD_HOME}', $DeckRoot)
    foreach ($match in [regex]::Matches($expanded, '\$\{([A-Za-z_][A-Za-z0-9_]*)\}')) {
        $name = $match.Groups[1].Value
        $envValue = [Environment]::GetEnvironmentVariable($name)
        if ($envValue) { $expanded = $expanded.Replace($match.Value, $envValue) }
    }
    return $expanded
}

function Get-ServiceSpec {
    param([string]$ServiceId)
    $spec = @($Manifest.services) | Where-Object { $_.id -eq $ServiceId } | Select-Object -First 1
    return $spec
}

function Get-Capabilities {
    param($Spec)
    if (-not $Spec) { return @() }
    # PS 5.1 unwraps single-element arrays from ConvertFrom-Json; re-wrap.
    return @($Spec.capabilities)
}

function Test-Enabled {
    param($Spec)
    if ($null -ne $Spec.enabled -and -not [bool]$Spec.enabled) { return $false }
    return $true
}

function Test-HttpQuiet {
    param([string]$Uri)
    try {
        $response = Invoke-WebRequest -UseBasicParsing -Uri $Uri -TimeoutSec 2
        return ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500)
    }
    catch { return $false }
}

function Test-PortListening {
    param([int]$Port)
    return [bool](Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction SilentlyContinue)
}

# Probe a service according to its health block. Returns $true when healthy.
function Test-ServiceHealth {
    param($Spec)
    $health = $Spec.health
    if (-not $health -or -not $health.type) {
        if ($Spec.port) { return Test-PortListening ([int]$Spec.port) }
        return $false
    }
    switch ([string]$health.type) {
        'http'    { return Test-HttpQuiet ([string](Expand-DeckPath $health.url)) }
        'port'    { return Test-PortListening ([int]$health.port) }
        'process' { return (@(Get-ProcessesByPattern ([string]$health.matchCommandLine) $health.expectName)).Count -gt 0 }
        default   { return Test-PortListening ([int]$Spec.port) }
    }
}

function Wait-ServiceHealth {
    param($Spec, [int]$TimeoutSeconds, [string]$Label)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-ServiceHealth $Spec) { return }
        Start-Sleep -Seconds 2
    }
    throw "$Label did not become ready within $TimeoutSeconds seconds. Check logs\$($Spec.id).* for details."
}

function Get-ReadyTimeout {
    param($Spec, [int]$Default = 60)
    foreach ($candidate in @($Spec.start.readyTimeoutSec, $Spec.health.readyTimeoutSec)) {
        if ($candidate) { return [int]$candidate }
    }
    return $Default
}

function Stop-ProcessTree {
    param([int]$ProcessId, [string]$Label)
    Write-Info "Stopping $Label (PID $ProcessId)..."
    & taskkill.exe /PID $ProcessId /T /F 2>$null | Out-Null
}

# Find live processes matching a command-line regex (and optional process
# image name). Verification is by command line so the engine never touches a
# process it cannot attribute to a service.
function Get-ProcessesByPattern {
    param([string]$Pattern, [string]$ExpectName)
    if (-not $Pattern) { return @() }
    $snapshot = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue)
    # Plain return: the pipeline unrolls the array, so EVERY caller must
    # collect with @(...). Counting directly on the call result breaks in
    # PS 5.1 for single hits (bare object, .Count is $null), and -NoEnumerate
    # or a comma prefix break the empty case (one wrapped array, Count 1).
    @($snapshot | Where-Object {
        $_.CommandLine -and
        $_.CommandLine -match $Pattern -and
        (-not $ExpectName -or $_.Name -eq $ExpectName)
    })
}

# Find live processes owned by a service using its stop.matchCommandLine
# pattern (and optional stop.expectName).
function Get-ServiceProcesses {
    param($Spec)
    if (-not $Spec.stop -or -not $Spec.stop.matchCommandLine) { return @() }
    return Get-ProcessesByPattern ([string]$Spec.stop.matchCommandLine) $Spec.stop.expectName
}

# ---------------------------------------------------------------- start kinds

function Start-ProcessService {
    param($Spec)
    $start = $Spec.start
    if (-not $start -or -not $start.exe) { throw "$($Spec.id) has kind 'process' but no start.exe definition." }

    $exe = Expand-DeckPath ([string]$start.exe)
    $resolved = Get-Command $exe -ErrorAction SilentlyContinue
    if ($resolved) { $exe = $resolved.Source }
    if (-not (Test-Path -LiteralPath $exe)) {
        throw "Executable for '$($Spec.id)' was not found: $exe"
    }

    $arguments = @()
    foreach ($arg in @($start.args)) { $arguments += [string](Expand-DeckPath $arg) }

    $cwd = if ($start.cwd) { Expand-DeckPath ([string]$start.cwd) } else { $DeckRoot }
    if (-not (Test-Path -LiteralPath $cwd)) { throw "Working directory for '$($Spec.id)' was not found: $cwd" }

    $stdoutLog = Join-Path $LogRoot "$($Spec.id).stdout.log"
    $stderrLog = Join-Path $LogRoot "$($Spec.id).stderr.log"
    $label = "Service '$($Spec.id)'"
    # Interactive tools (CLI agents, TUIs, GUI apps) declare
    # start.window "visible": launched with a normal window and no output
    # redirection, so their own console/UI owns the session.
    $visibleWindow = ([string]$start.window -eq 'visible')

    # Optional environment for the child: start.env (literal map) plus
    # start.envFile (KEY=VALUE lines, '#' comments and quoted values
    # tolerated). Applied to this action process only; Start-Process
    # children inherit it.
    if ($start.envFile) {
        $envFilePath = Expand-DeckPath ([string]$start.envFile)
        if (-not (Test-Path -LiteralPath $envFilePath)) {
            throw "envFile for '$($Spec.id)' was not found: $envFilePath"
        }
        foreach ($line in [System.IO.File]::ReadAllLines($envFilePath)) {
            $trimmed = $line.Trim()
            if (-not $trimmed -or $trimmed.StartsWith('#')) { continue }
            $separator = $trimmed.IndexOf('=')
            if ($separator -le 0) { continue }
            $name = $trimmed.Substring(0, $separator).Trim()
            $value = $trimmed.Substring($separator + 1).Trim()
            if ($value.Length -ge 2 -and $value.StartsWith('"') -and $value.EndsWith('"')) {
                $value = $value.Substring(1, $value.Length - 2)
            }
            Set-Item -Path ("Env:" + $name) -Value $value
        }
    }
    if ($start.env) {
        $start.env.PSObject.Properties | ForEach-Object {
            Set-Item -Path ("Env:" + $_.Name) -Value ([string]$_.Value)
        }
    }

    Write-Info "Starting $label..."
    if ($visibleWindow) {
        $process = Start-Process -FilePath $exe `
            -ArgumentList $arguments `
            -WorkingDirectory $cwd `
            -PassThru
    }
    else {
        $process = Start-Process -FilePath $exe `
            -ArgumentList $arguments `
            -WorkingDirectory $cwd `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog `
            -PassThru
    }

    try {
        Wait-ServiceHealth $Spec (Get-ReadyTimeout $Spec) $label
    }
    catch {
        if ($process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        }
        throw
    }
    Write-Ok "$label is ready."
}

function Get-DockerCli {
    $command = Get-Command docker.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    throw "docker.exe was not found. docker-compose services need Docker installed."
}

function Start-ComposeService {
    param($Spec)
    $composeFiles = @($Spec.composeFiles) | ForEach-Object { Expand-DeckPath ([string]$_) }
    foreach ($file in $composeFiles) {
        if (-not (Test-Path -LiteralPath $file)) { throw "Compose file for '$($Spec.id)' was not found: $file" }
    }
    $docker = Get-DockerCli

    $arguments = @('compose')
    foreach ($file in $composeFiles) { $arguments += @('-f', $file) }
    $envFile = Expand-DeckPath ([string]$Spec.envFile)
    if ($envFile) {
        if (-not (Test-Path -LiteralPath $envFile)) { throw "Compose env file for '$($Spec.id)' was not found: $envFile" }
        $arguments += @('--env-file', $envFile)
    }
    $arguments += @('up', '-d')

    Write-Info "Starting compose stack '$($Spec.id)'..."
    # Start-Process keeps docker's stderr out of this script's error stream
    # (PowerShell 5.1 turns redirected native stderr into terminating errors
    # under $ErrorActionPreference = 'Stop').
    $out = Join-Path $LogRoot "$($Spec.id).stdout.log"
    $err = Join-Path $LogRoot "$($Spec.id).stderr.log"
    $proc = Start-Process -FilePath $docker -ArgumentList $arguments -WindowStyle Hidden `
        -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -Wait
    if ($proc.ExitCode -ne 0) {
        throw "docker compose failed with exit code $($proc.ExitCode). See logs\$($Spec.id).stderr.log."
    }
    Wait-ServiceHealth $Spec (Get-ReadyTimeout $Spec 120) "Compose stack '$($Spec.id)'"
    Write-Ok "Compose stack '$($Spec.id)' is ready."
}

function Start-TunnelService {
    param($Spec)
    $sshSpec = $Spec.ssh
    if (-not $sshSpec) { throw "$($Spec.id) has kind 'ssh-tunnel' but no ssh definition." }

    $localPort = [int]$sshSpec.localPort
    $forward = "$($sshSpec.localPort):$($sshSpec.remoteHost):$($sshSpec.remotePort)"
    if (Test-PortListening $localPort) {
        if (Test-ServiceHealth $Spec) {
            Write-Ok "Tunnel '$($Spec.id)' is already forwarding on port $localPort."
            return
        }
        # A stale tunnel can hold the port without forwarding; recycle only
        # processes whose command line contains this exact forward spec.
        $stale = @(Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" -ErrorAction SilentlyContinue) |
            Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($forward) }
        if ($stale.Count -gt 0) {
            Write-WarnLine "Recycling a stale tunnel process for '$($Spec.id)'..."
            foreach ($proc in $stale) { Stop-ProcessTree ([int]$proc.ProcessId) "stale tunnel" }
            Start-Sleep -Seconds 2
        }
    }

    $sshCommand = Get-Command ssh.exe -ErrorAction SilentlyContinue
    if (-not $sshCommand) { throw 'ssh.exe was not found.' }
    $keyPath = Expand-DeckPath ([string]$sshSpec.keyPath)
    if (-not (Test-Path -LiteralPath $keyPath)) { throw "SSH key for '$($Spec.id)' was not found: $keyPath" }

    $arguments = @(
        '-N', '-L', $forward,
        '-i', $keyPath,
        '-o', 'BatchMode=yes',
        '-o', 'StrictHostKeyChecking=accept-new',
        '-o', 'ServerAliveInterval=60',
        '-o', 'ServerAliveCountMax=3',
        '-o', 'ExitOnForwardFailure=yes',
        [string]$sshSpec.host
    )

    Write-Info "Starting SSH tunnel '$($Spec.id)' ($forward)..."
    $out = Join-Path $LogRoot "$($Spec.id).stdout.log"
    $err = Join-Path $LogRoot "$($Spec.id).stderr.log"
    $process = Start-Process -FilePath $sshCommand.Source -ArgumentList $arguments -WindowStyle Hidden `
        -RedirectStandardOutput $out -RedirectStandardError $err -PassThru
    try {
        $deadline = (Get-Date).AddSeconds((Get-ReadyTimeout $Spec 30))
        while ((Get-Date) -lt $deadline) {
            $process.Refresh()
            if ($process.HasExited) {
                throw "SSH tunnel exited with code $($process.ExitCode). See logs\$($Spec.id).stderr.log."
            }
            if (Test-ServiceHealth $Spec) {
                Write-Ok "Tunnel '$($Spec.id)' is ready on port $localPort."
                return
            }
            Start-Sleep -Seconds 2
        }
        throw "Tunnel '$($Spec.id)' did not become ready within the timeout. See logs\$($Spec.id).stderr.log."
    }
    catch {
        if ($process -and -not $process.HasExited) {
            & taskkill.exe /PID $process.Id /T /F 2>$null | Out-Null
        }
        throw
    }
}

function Start-ServiceById {
    param([string]$ServiceId)
    $spec = Get-ServiceSpec $ServiceId
    if (-not $spec) { throw "Unknown service id: $ServiceId" }
    if (-not (Test-Enabled $spec)) { throw "Service '$ServiceId' is disabled (enabled: false) in the registry." }
    if ((Get-Capabilities $spec) -notcontains 'start') {
        throw "Service '$ServiceId' does not expose the start capability."
    }
    if (Test-ServiceHealth $spec) {
        Write-Ok "Service '$ServiceId' is already running."
        return
    }
    switch ([string]$spec.kind) {
        'process' { Start-ProcessService $spec }
        'docker-compose' { Start-ComposeService $spec }
        'ssh-tunnel' { Start-TunnelService $spec }
        'external' { throw "Service '$ServiceId' is externally managed; the deck only monitors it." }
        default { throw "Service '$ServiceId' has unknown kind '$($spec.kind)'." }
    }
}

# ---------------------------------------------------------------- stop logic

function Stop-ServiceById {
    param([string]$ServiceId)
    $spec = Get-ServiceSpec $ServiceId
    if (-not $spec) { throw "Unknown service id: $ServiceId" }
    if ((Get-Capabilities $spec) -notcontains 'stop') {
        throw "Service '$ServiceId' does not expose the stop capability."
    }

    if ([string]$spec.kind -eq 'docker-compose') {
        $composeFiles = @($spec.composeFiles) | ForEach-Object { Expand-DeckPath ([string]$_) }
        $docker = Get-DockerCli
        $arguments = @('compose')
        foreach ($file in $composeFiles) { $arguments += @('-f', $file) }
        $envFile = Expand-DeckPath ([string]$spec.envFile)
        if ($envFile) { $arguments += @('--env-file', $envFile) }
        $arguments += @('stop')
        Write-Info "Stopping compose stack '$ServiceId' (data is preserved)..."
        $out = Join-Path $LogRoot "$ServiceId.stdout.log"
        $err = Join-Path $LogRoot "$ServiceId.stderr.log"
        $proc = Start-Process -FilePath $docker -ArgumentList $arguments -WindowStyle Hidden `
            -RedirectStandardOutput $out -RedirectStandardError $err -PassThru -Wait
        if ($proc.ExitCode -ne 0) {
            throw "docker compose stop failed with exit code $($proc.ExitCode)."
        }
        Write-Ok "Compose stack '$ServiceId' stopped."
        return
    }

    if ([string]$spec.kind -eq 'ssh-tunnel') {
        # Tunnels are attributed by their exact forward spec, same rule the
        # stale-recycler uses on start.
        $forward = "$($spec.ssh.localPort):$($spec.ssh.remoteHost):$($spec.ssh.remotePort)"
        $tunnels = @(Get-CimInstance Win32_Process -Filter "Name='ssh.exe'" -ErrorAction SilentlyContinue) |
            Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($forward) }
        if ($tunnels.Count -eq 0) {
            if (Test-ServiceHealth $spec) {
                throw "Tunnel '$ServiceId' is still up but no ssh process matches its forward spec."
            }
            Write-Info "Tunnel '$ServiceId' is not running."
            return
        }
        foreach ($proc in $tunnels) {
            Stop-ProcessTree ([int]$proc.ProcessId) "Tunnel '$ServiceId'"
        }
        Start-Sleep -Seconds 2
        if (Test-ServiceHealth $spec) {
            throw "Tunnel '$ServiceId' is still forwarding after the stop request."
        }
        Write-Ok "Tunnel '$ServiceId' stopped."
        return
    }

    $processes = @(Get-ServiceProcesses $spec)
    if ($processes.Count -eq 0) {
        if (Test-ServiceHealth $spec) {
            # Never report success while the endpoint is still up: an
            # unattributable-but-alive service means stop.matchCommandLine
            # needs to be refined, not silently ignored.
            throw "Service '$ServiceId' is still responding but no process matches stop.matchCommandLine. Refine the pattern in the registry."
        }
        Write-Info "Service '$ServiceId' is not running."
        return
    }
    foreach ($proc in $processes) {
        Stop-ProcessTree ([int]$proc.ProcessId) "Service '$ServiceId'"
    }
    Start-Sleep -Seconds 2
    if (Test-ServiceHealth $spec) {
        throw "Service '$ServiceId' is still responding after the stop request."
    }
    Write-Ok "Service '$ServiceId' stopped."
}

# ---------------------------------------------------------------- status

function Get-StatusJson {
    $states = [ordered]@{}
    foreach ($spec in @($Manifest.services)) {
        if (-not (Test-Enabled $spec)) {
            $states[$spec.id] = [ordered]@{ state = 'disabled' }
            continue
        }
        $state = if (Test-ServiceHealth $spec) { 'ready' } else { 'stopped' }
        $entry = [ordered]@{ state = $state }
        if ($spec.port) { $entry.port = [int]$spec.port }
        $states[$spec.id] = $entry
    }
    [ordered]@{
        generatedAt = (Get-Date).ToString('o')
        services    = $states
    } | ConvertTo-Json -Depth 5 -Compress
}

# ---------------------------------------------------------------- probe report

# Maintenance action: audit every entry's health probe against the live
# process table. For process probes, reports raw pattern hits (ignoring
# expectName) next to final hits so a wrong expectName is immediately
# visible — the "Claude Code is claude.exe, not node.exe" lesson in
# machine-readable form. CLI-only; the dashboard never invokes it.
function Get-ProbeReport {
    $entries = @()
    foreach ($spec in @($Manifest.services)) {
        $notes = @()
        $probe = [ordered]@{
            id          = [string]$spec.id
            kind        = [string]$spec.kind
            healthType  = [string]$spec.health.type
            state       = if (Test-Enabled $spec) { if (Test-ServiceHealth $spec) { 'ready' } else { 'stopped' } } else { 'disabled' }
        }

        if ($spec.health -and [string]$spec.health.type -eq 'process') {
            $rawPattern = [string]$spec.health.matchCommandLine
            $expectName = [string]$spec.health.expectName
            $rawHits = @(Get-ProcessesByPattern $rawPattern $null)
            $finalHits = @(Get-ProcessesByPattern $rawPattern $expectName)
            $probe.rawHits = $rawHits.Count
            $probe.rawHitNames = @($rawHits | Select-Object -First 5 | ForEach-Object { $_.Name })
            $probe.finalHits = $finalHits.Count
            if ($rawHits.Count -gt 0 -and $finalHits.Count -eq 0) {
                $notes += "pattern matches $($rawHits.Count) process(es) named [$($probe.rawHitNames -join ', ')] but none match expectName '$expectName' — the real image name differs; update expectName from the observed names"
            }
            if ($rawHits.Count -eq 0 -and $probe.state -eq 'ready') {
                $notes += 'state is ready but the pattern matches nothing — probe and state disagree; re-audit this entry'
            }
        }
        elseif (-not $spec.health -and -not $spec.port) {
            $notes += 'no health block and no port — this entry can never report ready'
        }

        $probe.notes = $notes
        $entries += [pscustomobject]$probe
    }

    [ordered]@{
        generatedAt = (Get-Date).ToString('o')
        entries     = $entries
    } | ConvertTo-Json -Depth 6
}

# ---------------------------------------------------------------- dispatch

try {
    switch -Regex ($Action) {
        '^status-json$'   { Get-StatusJson }
        '^probe-report$'  { Get-ProbeReport }
        '^start-common$'  { foreach ($spec in @($Manifest.services)) { if ($spec.common -and (Test-Enabled $spec) -and (Get-Capabilities $spec) -contains 'start') { Start-ServiceById ([string]$spec.id) } } }
        '^stop-common$'   { foreach ($spec in @($Manifest.services)) { if ($spec.common -and (Get-Capabilities $spec) -contains 'stop') { Stop-ServiceById ([string]$spec.id) } } }
        '^(start)-(.+)$'  { Start-ServiceById ($Matches[2]) }
        '^(stop)-(.+)$'   { Stop-ServiceById ($Matches[2]) }
    }
    exit 0
}
catch {
    if (-not $Script:MachineMode) {
        Write-Host ''
        Write-Host "Operation failed: $($_.Exception.Message)" -ForegroundColor Red
    }
    Write-Log "ERROR [$Action]: $($_.Exception.Message)"
    if (-not $NoPauseOnError -and -not $Script:MachineMode) {
        Read-Host 'Press Enter to close' | Out-Null
    }
    exit 1
}
