# Quick setup for Windows: install and set the admin password.
#
# Usage: powershell -ExecutionPolicy Bypass -File .\setup.ps1 [-Python | -Docker]
#   -Python  virtualenv in .venv (default)
#   -Docker  build the image and run the app in a container with a data volume
# Without a switch, an interactive session is asked which one to use when Docker is available.
param([switch]$Python, [switch]$Docker)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Set-Location -LiteralPath $PSScriptRoot

$Image = 'fgc-scoreboard'
$Container = 'fgc-scoreboard'
$Volume = 'fgc-data'
$CheckConfigured = 'import sys; from auth import is_configured; sys.exit(0 if is_configured() else 1)'

function Fail {
    param([string]$Message, [int]$Code = 1)
    Write-Host $Message -ForegroundColor Red
    exit $Code
}

function Test-Native {
    # Runs a native command silently; returns $true on exit code 0, $false otherwise (incl. not found).
    param([string]$Exe, [string[]]$Arguments)
    $ErrorActionPreference = 'Continue'
    try { & $Exe @Arguments *> $null } catch { return $false }
    return ($LASTEXITCODE -eq 0)
}

function Test-DockerUsable {
    if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { return $false }
    return (Test-Native 'docker' @('info'))
}

if ($Python -and $Docker) {
    Fail 'Usage: .\setup.ps1 [-Python | -Docker]' 2
}

$interactive = -not [Console]::IsInputRedirected

$mode = ''
if ($Docker) { $mode = 'docker' }
elseif ($Python) { $mode = 'python' }
else {
    $mode = 'python'
    if ($interactive -and (Test-DockerUsable)) {
        $answer = Read-Host 'Install with [1] Python virtualenv or [2] Docker? [1]'
        if ($answer.Trim() -eq '2') { $mode = 'docker' }
    }
}

# ---- install + password + start ----
if ($mode -eq 'docker') {
    if (-not (Test-DockerUsable)) {
        Fail 'Docker is not installed or the Docker engine is not running (start Docker Desktop).'
    }
    docker build -t $Image .
    if ($LASTEXITCODE -ne 0) { Fail 'docker build failed.' }

    docker run --rm -v "${Volume}:/data" $Image -c $CheckConfigured
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Admin password already set (reset it with: docker run --rm -it -v ${Volume}:/data $Image setup_password.py)."
    } else {
        $ttyFlag = '-i'
        if ($interactive) { $ttyFlag = '-it' }
        docker run --rm $ttyFlag -v "${Volume}:/data" $Image setup_password.py
        if ($LASTEXITCODE -ne 0) { exit 1 }
    }

    Test-Native 'docker' @('rm', '-f', $Container) | Out-Null
    docker run -d --name $Container --restart unless-stopped -p 8000:8000 -v "${Volume}:/data" $Image | Out-Null
    if ($LASTEXITCODE -ne 0) { Fail 'docker run failed.' }

    Write-Host @"

Setup complete. The app is running in container "$Container".

    docker logs -f $Container     # logs
    docker stop $Container        # stop
    docker start $Container       # start again

Open http://localhost:8000/control
"@
    exit 0
}

# Python branch. Never python3: on Windows it is usually the Microsoft Store alias stub.
$pyExe = $null
$pyArgs = @()
$candidates = @(
    @{ Exe = 'py'; Args = @('-3') },
    @{ Exe = 'python'; Args = @() }
)
foreach ($c in $candidates) {
    if (-not (Get-Command $c.Exe -ErrorAction SilentlyContinue)) { continue }
    if (Test-Native $c.Exe ([string[]]($c.Args + @('-c', 'import sys')))) {
        $pyExe = $c.Exe
        $pyArgs = [string[]]$c.Args
        break
    }
}
if (-not $pyExe) {
    Fail 'Python 3.10+ not found. Install it from https://www.python.org/downloads/ and re-run .\setup.ps1.'
}

if (-not (Test-Native $pyExe ([string[]]($pyArgs + @('-c', 'import sys; sys.exit(sys.version_info < (3, 10))'))))) {
    $ErrorActionPreference = 'Continue'
    $ver = (& $pyExe @pyArgs -V 2>&1 | Out-String).Trim()
    $ErrorActionPreference = 'Stop'
    Fail "Python 3.10+ required (found $ver)."
}

$venvPy = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (Test-Path -LiteralPath (Join-Path $PSScriptRoot '.venv')) {
    if (-not (Test-Path -LiteralPath $venvPy)) {
        Fail '.venv exists but is not a Windows virtualenv (no .venv\Scripts\python.exe). Delete the .venv folder and re-run .\setup.ps1.'
    }
} else {
    & $pyExe @pyArgs -m venv .venv
    if ($LASTEXITCODE -ne 0) { Fail 'Creating .venv failed.' }
}

& $venvPy -m pip install --quiet --upgrade pip
if ($LASTEXITCODE -ne 0) { Fail 'pip install failed.' }
& $venvPy -m pip install --quiet -r requirements.txt
if ($LASTEXITCODE -ne 0) { Fail 'pip install failed.' }

if (Test-Native $venvPy @('-c', $CheckConfigured)) {
    Write-Host 'Admin password already set (reset it with: .venv\Scripts\python.exe setup_password.py).'
} else {
    & $venvPy setup_password.py
    if ($LASTEXITCODE -ne 0) { exit 1 }
}

Write-Host @'

Setup complete. Start the server with:

    .venv\Scripts\python.exe run.py

Then open http://localhost:8000/control
'@
