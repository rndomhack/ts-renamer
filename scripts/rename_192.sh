#!/bin/bash

basedir=`dirname "$0"`

while [ "$#" -gt 0 ]; do
    echo -e "\n### \"$1\""

    node "$basedir/../cli.js" --input "$1" --dir '${firstStartYYYY}_Q${firstStartQuarter}/${title}' --file '${title}([ 第${count2}話])([ 「${subTitle}」])([ (${channelUserName})])' --packet_size 192

    if [ "$?" -eq 0 ]; then
        echo "OK: $1" >> "$basedir/../log/rename.log"
    else
        echo "NG: $1" >> "$basedir/../log/rename.log"
    fi

    shift
done

echo done
read wait
