' Starts the Zoi lab agent with no console window at all.
' The agent is a long-running watcher, so this does not exit when it starts:
' it hands off to the .cmd and returns immediately, and the agent keeps
' running invisibly for the session.
'
' This is the file to put in the Startup folder. Running the .cmd directly from
' Startup gives a black console window that sits on the desktop for as long as
' the agent runs - which is all day, so it looks like it never closes.
Option Explicit
Dim fso, sh, here, cmd, node
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

here = fso.GetParentFolderName(WScript.ScriptFullName)
cmd = here & "\zoi-lab-agent.cmd"

If Not fso.FileExists(cmd) Then
  here = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\zoi"
  cmd = here & "\zoi-lab-agent.cmd"
End If

If Not fso.FileExists(cmd) Then WScript.Quit 1

' 0 = hidden window, False = do not wait for it. The .cmd stays on disk so it
' can still be run by hand to watch the output when something needs debugging.
sh.CurrentDirectory = here
sh.Run """" & cmd & """", 0, False
