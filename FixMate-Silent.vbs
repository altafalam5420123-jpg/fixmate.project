Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)
serverDir = currentDir & "\fixmate\server"

' Start Node server invisibly in background (0 = hidden window)
WshShell.Run "cmd /c cd /d """ & serverDir & """ && node src/server.js", 0, False

' Wait 1 second for server to initialize
WScript.Sleep 1200

' Open FixMate in browser
WshShell.Run "http://localhost:3000"

