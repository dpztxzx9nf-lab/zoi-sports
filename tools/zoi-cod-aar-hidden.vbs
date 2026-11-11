' Starts the Call of Duty scoreboard watcher with no console window.
Option Explicit
Dim fso, sh, here, ps, script
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
script = here & "\zoi-cod-aar.ps1"
If Not fso.FileExists(script) Then WScript.Quit 1

ps = sh.ExpandEnvironmentStrings("%SystemRoot%") & "\System32\WindowsPowerShell\v1.0\powershell.exe"
If Not fso.FileExists(ps) Then ps = "powershell.exe"

sh.CurrentDirectory = here
' 0 = hidden, False = do not wait
sh.Run """" & ps & """ -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & script & """", 0, False
