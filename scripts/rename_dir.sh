#!/bin/bash

basedir=`dirname "$0"`

while [ "$#" -gt 0 ]; do
    echo -e "\n## \"$1\""

    find "$1" -name "*.ts" | while read file; do
        echo -e "\n### \"$file\""
        node "$basedir/../cli.js" -i "$file" -d '${firstStartYYYY}_Q${firstStartQuarter}/${title}' -f '${title}([ 第${count2}話])([ 「${subTitle}」])([ (${channelUserName})])'

        if [ "$?" -eq 0 ]; then
            echo "OK: $file" >> "$basedir/../log/rename.log"
        else
            echo "NG: $file" >> "$basedir/../log/rename.log"
        fi
    done

    shift
done

echo done
read wait
