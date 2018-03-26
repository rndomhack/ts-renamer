@echo off

set src=

if exist "%src%\bin\node.exe" (
  "%src%\bin\node.exe" "%src%\cli.js" "$FilePath$"
) else (
  node "%src%\cli.js" "$FilePath$"
)
