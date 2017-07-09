@echo off

set parent=
set dir=${firstStartYYYY}_Q${firstStartQuarter}/${title}
set file=${title}([ ëÊ${count2}òb])([ Åu${subTitle}Åv])([ (${channelUserName})])
set error_dir=ts-renamer/${error}
set error_file=${original}
set packet_size=188
set check_service=false
set check_time=false
set check_dup=false
set check_drop=false

set log_file=%~dp0..\log\rename.log

if exist "%~dp0../bin/node.exe" (
  "%~dp0../bin/node.exe" "%~dp0../dragdrop.js" %*
) else (
  node "%~dp0../dragdrop.js" %*
)

pause
