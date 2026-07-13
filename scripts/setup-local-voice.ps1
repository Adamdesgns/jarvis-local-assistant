param(
    [string]$DataRoot = (Split-Path -Parent $PSScriptRoot),
    [string]$SourceRoot = $PSScriptRoot,
    [switch]$NoPause
)

$ErrorActionPreference = "Stop"
$Venv = Join-Path $DataRoot ".venv"
$Python = $null

New-Item -ItemType Directory -Force -Path $DataRoot | Out-Null

Write-Host ""
Write-Host "JARVIS LOCAL VOICE SETUP" -ForegroundColor Yellow
Write-Host "No API key, subscription, or credits are required." -ForegroundColor Gray
Write-Host ""

if (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3.12 -c "import sys; print(sys.version)" 2>$null
    if ($LASTEXITCODE -eq 0) {
        $Python = "py"
        $PythonArgs = @("-3.12")
    }
}

if (-not $Python -and (Get-Command python -ErrorAction SilentlyContinue)) {
    $Python = "python"
    $PythonArgs = @()
}

if (-not $Python) {
    Write-Host "Installing Python 3.12..." -ForegroundColor Cyan
    if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
        throw "Python is not installed and Windows Package Manager was not found. Install Python 3.12 from python.org, then run this again."
    }
    winget install --id Python.Python.3.12 -e --accept-package-agreements --accept-source-agreements
    $Python = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
    $PythonArgs = @()
}

Write-Host "Creating the private JARVIS voice environment..." -ForegroundColor Cyan
& $Python @PythonArgs -m venv $Venv
$VenvPython = Join-Path $Venv "Scripts\python.exe"

Write-Host "Installing free local voice components..." -ForegroundColor Cyan
& $VenvPython -m pip install --upgrade pip
& $VenvPython -m pip install -r (Join-Path $SourceRoot "local-voice-requirements.txt")

Write-Host "Downloading the local Hey Jarvis and speech models..." -ForegroundColor Cyan
& $VenvPython (Join-Path $SourceRoot "local_voice.py") --prepare

Write-Host ""
Write-Host "LOCAL VOICE IS READY." -ForegroundColor Green
Write-Host "Restart JARVIS, then say: Hey Jarvis" -ForegroundColor White
Write-Host ""
if (-not $NoPause) { Read-Host "Press Enter to close" }
