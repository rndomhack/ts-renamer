@echo off

set src=

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

set log_file=%src%\log\rename.log
set get_args=false

if exist "%src%\bin\node.exe" (
  "%src%\bin\node.exe" "%src%\dragdrop.js" "$FilePath$"
) else (
  node "%src%\dragdrop.js" "$FilePath$"
)
