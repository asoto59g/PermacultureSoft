' Abre PermacultureSoft con doble clic.
'
' Lo unico que hace este archivo es arrancar scripts\launcher.ps1 con la ventana
' oculta: sin este rodeo, PowerShell siempre asoma una consola negra.

Option Explicit

Dim shell, fso, root, script, command

Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

root = fso.GetParentFolderName(WScript.ScriptFullName)
script = fso.BuildPath(root, "scripts\launcher.ps1")

If Not fso.FileExists(script) Then
  MsgBox "No se encontro scripts\launcher.ps1." & vbCrLf & vbCrLf & _
         "Este archivo debe quedarse en la carpeta del proyecto; " & _
         "para tenerlo en el escritorio usa un acceso directo.", _
         16, "PermacultureSoft"
  WScript.Quit 1
End If

command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """"
shell.Run command, 0, False
