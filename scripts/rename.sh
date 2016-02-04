#!/bin/bash

basedir=`dirname "$0"`

while [ "$#" -gt 0 ]; do
    echo -e "\n### \"$1\""

    node "$basedir/../cli.js" -i "$1" -d '${firstStartYYYY}_Q${firstStartQuarter}/${title}' -f '${title}([ 第${count2}話])([ 「${subTitle}」])([ (${channelUserName})])'

    if [ "$?" -eq 0 ]; then
        echo "OK: $1" >> "$basedir/../log/rename.log"
    else
        echo "NG: $1" >> "$basedir/../log/rename.log"
    fi

    shift
done

echo done
read wait
