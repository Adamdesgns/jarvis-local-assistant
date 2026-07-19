' Launches JARVIS without a console window. Safe to double-click twice:
' the app's single-instance lock makes a second launch exit quietly.
' Lives in scripts/, so the app root is this file's parent's parent.
Set fso = CreateObject("Scripting.FileSystemObject")
Set shell = CreateObject("WScript.Shell")
appRoot = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
shell.CurrentDirectory = appRoot
shell.Run "cmd /c npm start", 0, False
