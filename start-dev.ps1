# Arranca FastAPI (:8000) y Next.js (:3000)
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$backend = Join-Path $root "backend"
$frontend = Join-Path $root "frontend"
$uvicorn = Join-Path $backend "venv\Scripts\uvicorn.exe"

if (-not (Test-Path $uvicorn)) {
  Write-Error "No se encontró $uvicorn. Crea el venv e instala requirements.txt."
  exit 1
}

Write-Host "Backend  http://127.0.0.1:8000"
Start-Process -WorkingDirectory $backend -FilePath $uvicorn -ArgumentList "main:app","--host","0.0.0.0","--port","8000","--reload"

Start-Sleep -Seconds 2
Write-Host "Frontend http://localhost:3000"
Set-Location $frontend
npm run dev
