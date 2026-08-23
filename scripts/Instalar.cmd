@echo off
rem Instalacion de una sola vez. La consola se deja a la vista porque
rem descargar dependencias tarda; al terminar abre la aplicacion sola.
title Instalar PermacultureSoft
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
if errorlevel 1 (
  echo.
  echo La instalacion no termino. Revisa el mensaje de arriba.
  pause
  exit /b 1
)
exit /b 0
