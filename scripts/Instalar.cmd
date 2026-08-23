@echo off
rem Instalacion de una sola vez. A diferencia del lanzador, aqui la consola se
rem deja a la vista: descargar dependencias tarda y conviene ver el avance.
title Instalar PermacultureSoft
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1"
echo.
pause
