@echo off
rem Instalacion fuera de OneDrive. Clona o actualiza en
rem %USERPROFILE%\PermacultureSoft y corre el instalador alli.
title Instalar PermacultureSoft (copia local)
set "DEST=%USERPROFILE%\PermacultureSoft"
set "REPO=https://github.com/asoto59g/PermacultureSoft.git"

where git >nul 2>&1
if errorlevel 1 (
  echo ERROR: no se encontro git. Instalalo desde https://git-scm.com/download/win
  pause
  exit /b 1
)

echo Destino: %DEST%
echo.

if not exist "%DEST%\.git" (
  echo Clonando el repositorio fuera de OneDrive...
  git clone "%REPO%" "%DEST%"
  if errorlevel 1 (
    echo ERROR: fallo git clone.
    pause
    exit /b 1
  )
) else (
  echo Ya existe. Actualizando con git pull...
  git -C "%DEST%" pull --ff-only
  if errorlevel 1 (
    echo No se pudo actualizar (cambios locales o red). Se instala lo que ya hay.
  )
)

echo.
echo Instalando en la copia local...
call "%DEST%\scripts\Instalar.cmd"
exit /b %ERRORLEVEL%
