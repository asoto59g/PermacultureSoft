<#
  Instalacion de una sola vez. Crea el venv, instala dependencias y deja un
  acceso en el escritorio. Se lanza desde Instalar.cmd para que se vea el avance.

  -ShortcutOnly  solo recrea el acceso del escritorio.
#>

param([switch]$ShortcutOnly)

$ErrorActionPreference = 'Stop'

$Root     = Split-Path -Parent $PSScriptRoot
$Backend  = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$VenvPy   = Join-Path $Backend 'venv\Scripts\python.exe'
$Req      = Join-Path $Backend 'requirements.txt'

function Write-Step([string]$text) {
  Write-Host ""
  Write-Host "==> $text" -ForegroundColor Cyan
}

function Fail([string]$text) {
  Write-Host ""
  Write-Host "ERROR: $text" -ForegroundColor Red
  exit 1
}

function Resolve-PythonExe([string]$launcher, [string[]]$launcherArgs) {
  try {
    $printed = & $launcher @($launcherArgs + @('-c', 'import sys; print(sys.executable)')) 2>$null
    if (-not $printed) { return $null }
    $exe = ($printed | Select-Object -Last 1).ToString().Trim()
    if (-not $exe -or -not (Test-Path $exe)) { return $null }
    # El alias de la Store no instala paquetes nativos (rasterio/GDAL).
    if ($exe -match 'WindowsApps') { return $null }
    return $exe
  } catch {
    return $null
  }
}

function Find-Python {
  # py -3 elige el mas nuevo (aqui 3.14). rasterio y GDAL van mas
  # sobrados en 3.11–3.13. Se omiten los Python de WindowsApps.
  foreach ($tag in @('-3.12', '-3.11', '-3.13')) {
    if (-not (Get-Command py -ErrorAction SilentlyContinue)) { break }
    $exe = Resolve-PythonExe 'py' @($tag)
    if (-not $exe) { continue }
    $ver = (& $exe --version 2>&1 | Out-String).Trim()
    return @{ Exe = $exe; Version = $ver }
  }
  foreach ($path in @(
      "$env:LOCALAPPDATA\Programs\Python\Python312\python.exe",
      "$env:LOCALAPPDATA\Programs\Python\Python311\python.exe",
      "$env:LOCALAPPDATA\Programs\Python\Python313\python.exe",
      "$env:ProgramFiles\Python312\python.exe",
      "$env:ProgramFiles\Python311\python.exe"
    )) {
    if (-not (Test-Path $path)) { continue }
    $ver = (& $path --version 2>&1 | Out-String).Trim()
    if ($ver -match 'Python 3\.(1[1-3])\b') {
      return @{ Exe = $path; Version = $ver }
    }
  }
  foreach ($c in @(
      @{ Cmd = 'py';     Args = @('-3') },
      @{ Cmd = 'python'; Args = @() }
    )) {
    if (-not (Get-Command $c.Cmd -ErrorAction SilentlyContinue)) { continue }
    $exe = Resolve-PythonExe $c.Cmd $c.Args
    if (-not $exe) { continue }
    $ver = (& $exe --version 2>&1 | Out-String).Trim()
    if ($ver -notmatch 'Python 3\.(\d+)') { continue }
    if ([int]$Matches[1] -lt 11) { continue }
    return @{ Exe = $exe; Version = $ver }
  }
  return $null
}

function Find-Node {
  foreach ($path in @(
      "$env:ProgramFiles\nodejs\node.exe",
      "${env:ProgramFiles(x86)}\nodejs\node.exe",
      "C:\nvm4w\nodejs\node.exe",
      (Join-Path $env:APPDATA 'nvm\nodejs\node.exe'),
      (Join-Path $env:LOCALAPPDATA 'fnm_multishells\node.exe')
    )) {
    if ($path -and (Test-Path $path)) { return $path }
  }
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd -and $cmd.Source -notmatch 'WindowsApps') { return $cmd.Source }
  return $null
}

function Find-Npm($nodeExe) {
  $sibling = Join-Path (Split-Path $nodeExe) 'npm.cmd'
  if (Test-Path $sibling) { return $sibling }
  $cmd = Get-Command npm -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  return $null
}

function Start-App {
  $vbs = Join-Path $Root 'PermacultureSoft.vbs'
  if (-not (Test-Path $vbs)) {
    Write-Host "    No se encontro PermacultureSoft.vbs; no se puede abrir la aplicacion." -ForegroundColor Yellow
    return
  }
  Start-Process -FilePath 'wscript.exe' -ArgumentList "`"$vbs`""
}

function New-DesktopShortcut {
  $desktop = [Environment]::GetFolderPath('Desktop')
  if (-not $desktop) { return $null }
  $vbs = Join-Path $Root 'PermacultureSoft.vbs'
  $lnk = Join-Path $desktop 'PermacultureSoft.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $sc = $shell.CreateShortcut($lnk)
  $sc.TargetPath = $vbs
  $sc.WorkingDirectory = $Root
  $sc.Description = 'PermacultureSoft - diseno de paisaje'
  $sc.WindowStyle = 1
  $sc.Save()
  return $lnk
}

if ($ShortcutOnly) {
  $lnk = New-DesktopShortcut
  if ($lnk) {
    Write-Host "Acceso creado: $lnk"
    exit 0
  }
  Write-Host "No se pudo crear el acceso del escritorio." -ForegroundColor Red
  exit 1
}

Write-Host "PermacultureSoft - instalacion"
Write-Host "Carpeta: $Root"

# ------------------------------------------------------------------ requisitos

Write-Step "Comprobando Python 3.11+ y Node.js 20+"

$python = Find-Python
if (-not $python) {
  Fail "No se encontro Python 3.11 o superior. Instalalo desde https://www.python.org/downloads/ y marca 'Add python.exe to PATH'."
}
Write-Host "    $($python.Version)  ($($python.Exe))"

$nodeExe = Find-Node
if (-not $nodeExe) {
  Fail "No se encontro Node.js. Instalalo desde https://nodejs.org/ (LTS 20 o superior)."
}
$nodeVer = & $nodeExe --version
Write-Host "    Node $nodeVer  ($nodeExe)"
if ($nodeVer -notmatch 'v(\d+)') { Fail "No se pudo leer la version de Node." }
if ([int]$Matches[1] -lt 20) { Fail "Node $nodeVer es demasiado viejo. Hace falta 20 o superior." }

$npmCmd = Find-Npm $nodeExe
if (-not $npmCmd) { Fail "Node esta instalado pero no se encontro npm." }
Write-Host "    npm  ($npmCmd)"

# npm.cmd lanza "node" por PATH. Si Node esta en Program Files pero la
# sesion no lo heredo (instalacion reciente, o Find-Node lo hallo por ruta),
# los postinstall fallan con "node no se reconoce".
$nodeDir = Split-Path $nodeExe
$env:PATH = "$nodeDir;$env:PATH"

if ($Root -match 'OneDrive') {
  Write-Host "    Aviso: esta carpeta esta en OneDrive. npm suele fallar con EPERM." -ForegroundColor Yellow
  Write-Host "    Para una instalacion limpia: doble clic en scripts\InstalarLimpio.cmd" -ForegroundColor Yellow
  Write-Host "    (clona en $env:USERPROFILE\PermacultureSoft, fuera de OneDrive)." -ForegroundColor Yellow
}

# ------------------------------------------------------------------ backend

Write-Step "Entorno de Python"
if (-not (Test-Path $VenvPy)) {
  Write-Host "    Creando venv..."
  & $python.Exe -m venv (Join-Path $Backend 'venv')
  if ($LASTEXITCODE -ne 0) { Fail "Fallo la creacion del venv." }
} else {
  Write-Host "    venv ya existe, se reutiliza."
}

Write-Host "    Instalando dependencias del backend (tarda la primera vez)..."
& $VenvPy -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { Fail "Fallo la actualizacion de pip." }
& $VenvPy -m pip install -r $Req
if ($LASTEXITCODE -ne 0) { Fail "Fallo la instalacion de requirements.txt." }

# ------------------------------------------------------------------ frontend

Write-Step "Dependencias del frontend"
$envFile = Join-Path $Frontend '.env.local'
$envExample = Join-Path $Frontend '.env.example'
if (-not (Test-Path $envFile) -and (Test-Path $envExample)) {
  Copy-Item $envExample $envFile
  Write-Host "    Creado frontend\.env.local a partir del ejemplo."
}

Push-Location $Frontend
try {
  # Un omit=optional viejo (npmrc de usuario o sesion) deja sin binario a Tailwind.
  Remove-Item Env:NPM_CONFIG_OMIT -ErrorAction SilentlyContinue
  # cmd.exe hereda mal el PATH de PowerShell; se fuerza en la misma linea.
  $npmLine = "set `"PATH=$nodeDir;%PATH%`" && `"$npmCmd`" "
  cmd.exe /c ($npmLine + "install --no-fund --no-audit")
  if ($LASTEXITCODE -ne 0) { Fail "Fallo npm install." }

  cmd.exe /c "set `"PATH=$nodeDir;%PATH%`" && `"$nodeExe`" -e `"require('lightningcss')`""
  if ($LASTEXITCODE -ne 0) {
    $arch = (& $nodeExe -p "process.arch").Trim()
    $native = "lightningcss-win32-$arch-msvc"
    Write-Host "    Falta el binario CSS ($native). Instalando..."
    cmd.exe /c ($npmLine + "install $native --no-save --no-fund --no-audit")
    if ($LASTEXITCODE -ne 0) { Fail "Fallo la instalacion de $native (necesario para Tailwind)." }
    cmd.exe /c "set `"PATH=$nodeDir;%PATH%`" && `"$nodeExe`" -e `"require('lightningcss')`""
    if ($LASTEXITCODE -ne 0) { Fail "Sigue sin cargarse lightningcss tras instalar $native." }
  }

  Write-Host "    Compilando la interfaz (un minuto la primera vez)..."
  cmd.exe /c ($npmLine + "run build")
  if ($LASTEXITCODE -ne 0) { Fail "Fallo la compilacion (npm run build)." }
} finally {
  Pop-Location
}

# ------------------------------------------------------------------ acceso

Write-Step "Acceso en el escritorio"
$lnk = New-DesktopShortcut
if ($lnk) {
  Write-Host "    $lnk"
} else {
  Write-Host "    No se pudo crear. Usa PermacultureSoft.vbs en la carpeta del proyecto."
}

Write-Step "Abriendo PermacultureSoft"
Start-App
Write-Host ""
Write-Host "Listo. Se abre la ventana de control y, en unos segundos, el navegador." -ForegroundColor Green
Write-Host "Para el dia a dia usa el acceso del escritorio; no hace falta volver a instalar."
