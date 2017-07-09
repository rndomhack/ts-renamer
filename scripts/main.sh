#!/bin/bash

basedir=`dirname "$0"`

export parent=
export dir='${firstStartYYYY}_Q${firstStartQuarter}/${title}'
export file='${title}([ 第${count2}話])([ 「${subTitle}」])([ (${channelUserName})])'
export error_dir='ts-renamer/${error}'
export error_file='${original}'
export packet_size=188
export check_service=false
export check_time=false
export check_dup=false
export check_drop=false

export log_file="$basedir/../log/rename.log"

node "$basedir/../dragdrop.js" "$@"

read wait
