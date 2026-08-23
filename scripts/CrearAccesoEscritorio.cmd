@echo off
title Acceso de escritorio - PermacultureSoft
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -ShortcutOnly
echo.
pause
