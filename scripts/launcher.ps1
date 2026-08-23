<#
  Lanzador de escritorio de PermacultureSoft.

  Arranca FastAPI y Next.js sin ventanas de consola, espera a que ambos
  respondan, abre la aplicacion y deja una ventana pequena como unico control
  visible: mientras este abierta la aplicacion vive, y al cerrarla se detienen
  los dos servidores.

  No se ejecuta a mano. Lo lanza PermacultureSoft.vbs, que es lo que oculta la
  consola de PowerShell.
#>

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$Root     = Split-Path -Parent $PSScriptRoot
$Backend  = Join-Path $Root 'backend'
$Frontend = Join-Path $Root 'frontend'
$LogDir   = Join-Path $Root 'logs'

$PythonExe = Join-Path $Backend 'venv\Scripts\python.exe'
$NextBin   = Join-Path $Frontend 'node_modules\next\dist\bin\next'
$NodeExe   = $null

$BackendPort  = 8000
$FrontendPort = 3000
$BackendUrl   = "http://127.0.0.1:$BackendPort/"
$AppUrl       = "http://127.0.0.1:$FrontendPort/"

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null
$LauncherLog = Join-Path $LogDir 'launcher.log'

# Procesos que arrancamos nosotros. Solo estos se detienen al cerrar: si la
# aplicacion ya estaba viva la dejamos como estaba.
$script:Owned = @()

# ---------------------------------------------------------------- utilidades

function Write-Log([string]$message) {
  try {
    Add-Content -Path $LauncherLog -Encoding UTF8 `
      -Value ('{0:yyyy-MM-dd HH:mm:ss}  {1}' -f (Get-Date), $message)
  } catch { }
}

function Show-Fatal([string]$message) {
  Write-Log "ERROR: $message"
  [System.Windows.Forms.MessageBox]::Show(
    "$message`n`nDetalle en:`n$LauncherLog",
    'PermacultureSoft', 'OK', 'Error') | Out-Null
}

<# Lanza un comando por cmd.exe con la salida a un archivo. Se usa cmd y no
   Start-Process porque CreateNoWindow de .NET es lo unico que garantiza que no
   asome una consola, y la redireccion del propio cmd evita tener que vaciar
   las tuberias para que el hijo no se bloquee. #>
function Start-Silent([string]$exe, [string]$arguments, [string]$workDir, [string]$logName) {
  $log = Join-Path $LogDir "$logName.log"
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = $env:ComSpec
  # cmd /c quita el par de comillas exterior y ejecuta el resto tal cual; es la
  # unica forma de pasar rutas con espacios sin que las parta.
  $psi.Arguments = '/c ""' + $exe + '" ' + $arguments + ' >"' + $log + '" 2>&1"'
  $psi.WorkingDirectory = $workDir
  $psi.UseShellExecute = $false
  $psi.CreateNoWindow = $true
  Write-Log "lanzando $logName : $($psi.Arguments)"
  return [System.Diagnostics.Process]::Start($psi)
}

function Stop-Tree([System.Diagnostics.Process]$proc) {
  if (-not $proc -or $proc.HasExited) { return }
  # /T porque cmd.exe es el padre y el servidor real es el hijo.
  & taskkill.exe /PID $proc.Id /T /F 2>&1 | Out-Null
}

function Get-LocalPage([string]$url, [int]$timeoutSec) {
  # 127.0.0.1 y proxy vacio: si se usa localhost, Windows a menudo manda
  # la peticion al proxy corporativo y el lanzador se queda congelado.
  $prev = [System.Net.WebRequest]::DefaultWebProxy
  try {
    [System.Net.WebRequest]::DefaultWebProxy = New-Object System.Net.WebProxy
    return Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeoutSec
  } finally {
    [System.Net.WebRequest]::DefaultWebProxy = $prev
  }
}

function Test-BackendUp {
  try {
    $page = Get-LocalPage $BackendUrl 3
    return ("$($page.Content)" -like '*PermacultureSoft*')
  } catch { return $false }
}

function Test-FrontendUp {
  try {
    $page = Get-LocalPage $AppUrl 5
    return ($page.StatusCode -eq 200 -and "$($page.Content)" -like '*PermacultureSoft*')
  } catch { return $false }
}

function Test-PortBusy([int]$port) {
  $client = New-Object System.Net.Sockets.TcpClient
  try {
    $iar = $client.BeginConnect('127.0.0.1', $port, $null, $null)
    $ok = $iar.AsyncWaitHandle.WaitOne(400)
    if (-not $ok) { return $false }
    $client.EndConnect($iar) | Out-Null
    return $client.Connected
  } catch {
    return $false
  } finally {
    $client.Close()
  }
}

function Find-Node {
  $cmd = Get-Command node -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  foreach ($path in @(
      "$env:ProgramFiles\nodejs\node.exe",
      "${env:ProgramFiles(x86)}\nodejs\node.exe"
    )) {
    if (Test-Path $path) { return $path }
  }
  return $null
}

<# Compila si no hay build o si el codigo cambio despues del ultimo build, para
   que quien actualice el repositorio no quede con una version vieja servida. #>
function Test-BuildStale {
  # Recorrer src en OneDrive tarda decenas de segundos. La compilacion
  # diaria se hace en Instalar.cmd; aqui solo se construye si no hay build.
  return -not (Test-Path (Join-Path $Frontend '.next\BUILD_ID'))
}

function Open-App {
  # Edge en modo aplicacion se ve como un programa propio, sin barra de
  # direcciones. Si no esta, el navegador por defecto sirve igual.
  try {
    Start-Process -FilePath 'msedge.exe' `
      -ArgumentList "--app=$AppUrl", '--window-size=1600,1000' -ErrorAction Stop
  } catch {
    Start-Process $AppUrl
  }
}

# ------------------------------------------------------- una sola instancia

$mutex = New-Object System.Threading.Mutex($false, 'Local\PermacultureSoftLauncher')
if (-not $mutex.WaitOne(0)) {
  Write-Log 'ya habia un lanzador abierto; solo se abre la ventana'
  Open-App
  return
}

# ------------------------------------------------------------------ ventana

$form                   = New-Object System.Windows.Forms.Form
$form.Text              = 'PermacultureSoft'
$form.ClientSize        = New-Object System.Drawing.Size(430, 168)
$form.StartPosition     = 'CenterScreen'
$form.FormBorderStyle   = 'FixedSingle'
$form.MaximizeBox       = $false
$form.BackColor         = [System.Drawing.Color]::FromArgb(24, 24, 27)
$form.ForeColor         = [System.Drawing.Color]::FromArgb(228, 228, 231)

$title           = New-Object System.Windows.Forms.Label
$title.Text      = 'PermacultureSoft'
$title.Font      = New-Object System.Drawing.Font('Segoe UI', 13, [System.Drawing.FontStyle]::Bold)
$title.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
$title.Location  = New-Object System.Drawing.Point(20, 16)
$title.AutoSize  = $true
$form.Controls.Add($title)

$statusLabel           = New-Object System.Windows.Forms.Label
$statusLabel.Text      = 'Preparando...'
$statusLabel.Font      = New-Object System.Drawing.Font('Segoe UI', 9)
$statusLabel.ForeColor = [System.Drawing.Color]::FromArgb(161, 161, 170)
$statusLabel.Location  = New-Object System.Drawing.Point(22, 48)
$statusLabel.Size      = New-Object System.Drawing.Size(388, 34)
$form.Controls.Add($statusLabel)
$script:statusLabel = $statusLabel

$bar          = New-Object System.Windows.Forms.ProgressBar
$bar.Style    = 'Marquee'
$bar.Location = New-Object System.Drawing.Point(22, 86)
$bar.Size     = New-Object System.Drawing.Size(386, 6)
$form.Controls.Add($bar)

$openButton           = New-Object System.Windows.Forms.Button
$openButton.Text      = 'Abrir'
$openButton.Location  = New-Object System.Drawing.Point(22, 110)
$openButton.Size      = New-Object System.Drawing.Size(190, 34)
$openButton.FlatStyle = 'Flat'
$openButton.BackColor = [System.Drawing.Color]::FromArgb(4, 120, 87)
$openButton.ForeColor = [System.Drawing.Color]::White
$openButton.Enabled   = $false
$openButton.Add_Click({ Open-App })
$form.Controls.Add($openButton)

$stopButton           = New-Object System.Windows.Forms.Button
$stopButton.Text      = 'Detener y salir'
$stopButton.Location  = New-Object System.Drawing.Point(218, 110)
$stopButton.Size      = New-Object System.Drawing.Size(190, 34)
$stopButton.FlatStyle = 'Flat'
$stopButton.BackColor = [System.Drawing.Color]::FromArgb(63, 63, 70)
$stopButton.ForeColor = [System.Drawing.Color]::White
$stopButton.Add_Click({ $form.Close() })
$form.Controls.Add($stopButton)

function Set-Status([string]$text) {
  $script:statusLabel.Text = $text
  Write-Log $text
  [System.Windows.Forms.Application]::DoEvents()
}

function Wait-Until([scriptblock]$test, [int]$timeoutSec) {
  $deadline = (Get-Date).AddSeconds($timeoutSec)
  while ((Get-Date) -lt $deadline) {
    if (& $test) { return $true }
    Start-Sleep -Milliseconds 600
    [System.Windows.Forms.Application]::DoEvents()
  }
  return $false
}

function Wait-Exit([System.Diagnostics.Process]$proc) {
  while (-not $proc.HasExited) {
    Start-Sleep -Milliseconds 200
    [System.Windows.Forms.Application]::DoEvents()
  }
}

# ------------------------------------------------------------------ arranque

$form.Add_Shown({
  try {
    Write-Log '--- arranque ---'

    if (-not (Test-Path $PythonExe)) {
      Set-Status 'Falta la instalacion.'
      $bar.Style = 'Continuous'
      Show-Fatal "No existe el entorno de Python:`n$PythonExe`n`nEjecuta scripts\Instalar.cmd una vez."
      $form.Close(); return
    }
    if (-not (Test-Path $NextBin)) {
      Set-Status 'Falta la instalacion.'
      $bar.Style = 'Continuous'
      Show-Fatal "Faltan las dependencias del frontend.`n`nEjecuta scripts\Instalar.cmd una vez."
      $form.Close(); return
    }
    $script:NodeExe = Find-Node
    if (-not $script:NodeExe) {
      Set-Status 'Falta Node.js.'
      $bar.Style = 'Continuous'
      Show-Fatal "No se encontro Node.js. Instalalo desde https://nodejs.org/ (LTS 20 o superior) y vuelve a ejecutar scripts\Instalar.cmd."
      $form.Close(); return
    }

    # -- backend
    if (Test-BackendUp) {
      Set-Status 'El servidor de calculo ya estaba corriendo.'
    } elseif (Test-PortBusy $BackendPort) {
      $bar.Style = 'Continuous'
      Show-Fatal "El puerto $BackendPort esta ocupado por otro programa. Cierralo y vuelve a intentar."
      $form.Close(); return
    } else {
      Set-Status 'Iniciando el servidor de calculo...'
      $proc = Start-Silent $PythonExe `
        "-m uvicorn main:app --host 127.0.0.1 --port $BackendPort" $Backend 'backend'
      $script:Owned += $proc
      if (-not (Wait-Until { Test-BackendUp } 90)) {
        $bar.Style = 'Continuous'
        Show-Fatal "El servidor de calculo no respondio.`nRevisa logs\backend.log."
        $form.Close(); return
      }
    }

    # -- frontend
    if (Test-FrontendUp) {
      Set-Status 'La aplicacion ya estaba corriendo.'
    } elseif (Test-PortBusy $FrontendPort) {
      $bar.Style = 'Continuous'
      Show-Fatal "El puerto $FrontendPort esta ocupado por otro programa. Cierralo y vuelve a intentar."
      $form.Close(); return
    } else {
      if (Test-BuildStale) {
        Set-Status "Compilando la aplicacion. La primera vez tarda cerca de un minuto..."
        $build = Start-Silent $script:NodeExe """$NextBin"" build" $Frontend 'build'
        Wait-Exit $build
        if ($build.ExitCode -ne 0) {
          $bar.Style = 'Continuous'
          Show-Fatal "Fallo la compilacion.`nRevisa logs\build.log."
          $form.Close(); return
        }
      }
      Set-Status 'Iniciando la aplicacion...'
      $proc = Start-Silent $script:NodeExe `
        """$NextBin"" start --hostname 127.0.0.1 --port $FrontendPort" $Frontend 'frontend'
      $script:Owned += $proc
      if (-not (Wait-Until { Test-FrontendUp } 90)) {
        $bar.Style = 'Continuous'
        Show-Fatal "La aplicacion no respondio.`nRevisa logs\frontend.log."
        $form.Close(); return
      }
    }

    $bar.Style = 'Continuous'
    $bar.Value = 100
    $bar.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
    Set-Status "Lista en $AppUrl`nDeja esta ventana abierta mientras trabajas."
    $openButton.Enabled = $true
    Open-App
  } catch {
    $bar.Style = 'Continuous'
    Show-Fatal "$($_.Exception.Message)"
    $form.Close()
  }
})

$form.Add_FormClosing({
  if ($script:Owned.Count -eq 0) { return }
  $script:statusLabel.Text = 'Deteniendo...'
  [System.Windows.Forms.Application]::DoEvents()
  foreach ($proc in $script:Owned) { Stop-Tree $proc }
  Write-Log 'detenido'
})

[void]$form.ShowDialog()
$mutex.ReleaseMutex()
