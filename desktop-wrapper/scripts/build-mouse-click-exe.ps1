$ErrorActionPreference = "Stop"

$projectRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
Set-Location $projectRoot

$python = $env:DESKTOP_WRAPPER_PYTHON
$pythonArgs = @()
if ([string]::IsNullOrWhiteSpace($python)) {
  $python = "py"
  $pythonArgs = @("-3")
}

Write-Host ("[build:click] Using: {0} {1}" -f $python, ($pythonArgs -join " "))

& $python @pythonArgs -m pip install --upgrade pip | Out-Host
& $python @pythonArgs -m pip install --upgrade pyinstaller pynput | Out-Host

New-Item -ItemType Directory -Force -Path "bin" | Out-Null
New-Item -ItemType Directory -Force -Path "build\pyinstaller" | Out-Null

& $python @pythonArgs -m PyInstaller `
  --noconfirm `
  --clean `
  --onefile `
  --name "mouse_click" `
  --distpath "bin" `
  --workpath "build\pyinstaller" `
  --specpath "build\pyinstaller" `
  "mouse_click.py" | Out-Host

if (-not (Test-Path "bin\mouse_click.exe")) {
  throw "[build:click] Build failed: bin\\mouse_click.exe not found."
}

Write-Host "[build:click] Done: bin\\mouse_click.exe"

